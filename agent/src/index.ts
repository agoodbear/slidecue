/**
 * SlideCue Mac agent。
 *
 * 常駐在筆電上，一邊盯著 Keynote，一邊用 WebSocket 把「現在第幾張、該念什麼」
 * 推給眼鏡端；反向也接收 R1 戒指的翻頁指令。
 *
 * 執行：npm run dev
 */

import { WebSocketServer, WebSocket } from 'ws'
import { createServer as createHttpServer } from 'node:http'
import { createServer } from 'node:net'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, openSync, createWriteStream, renameSync, unlinkSync, readFileSync, writeFileSync, statSync, copyFileSync, truncateSync } from 'node:fs'
import { dirname } from 'node:path'
import { networkInterfaces, hostname } from 'node:os'
import { snapshot, allNotes, listDocuments, pickKeynote, activeKeynoteId, type KeynoteSnapshot } from './keynote.ts'
import { buildDeck, type SlideScript } from './deck.ts'
import { advance, retreat, type AdvanceMethod } from './advance.ts'
import { AudioWindow, listenOnce, setWhisperEndpoint, whisperEndpoint } from './listen.ts'
import type { DeckState, AgentInfo, DeckBundle, ControlMessage, ControlMode } from '../../glasses/src/types.ts'

const PORT = Number(process.env.SLIDECUE_PORT ?? 8788)

/**
 * 輪詢間隔分三段。
 *
 * 這支是開機常駐的，多數時間 Keynote 根本沒開——那時每 1.5 秒問一次
 * 是純粹的浪費（每次 AppleScript 來回都要起一個 osascript 程序）。
 * 分成三段之後，閒置時的成本幾乎歸零，真正上台時才全速。
 */
/** 播放中：台上翻頁到眼鏡更新的延遲主要來自這裡，不能省。 */
const POLL_ACTIVE_MS = 250
/** Keynote 開著但還沒播放：準備上台的狀態，保持反應。 */
const POLL_OPEN_MS = 1500
/** Keynote 根本沒開：常駐時的預設狀態，降到最低。 */
const POLL_CLOSED_MS = 10_000

let deck: SlideScript[] = []
let deckName = ''
let mode: ControlMode = 'manual'
let advanceMethod: AdvanceMethod = 'none'

/**
 * 輪詢最近一次讀到的 Keynote 狀態。戒指翻頁直接用它，不再先問一次 Keynote——
 * 每問一次 AppleEvent 要 300–700 ms，這是舊版每按一下要 0.6–0.9 秒的主因。
 */
let lastSnap: KeynoteSnapshot | null = null
let lastSnapAt = 0
/** 戒指指令執行中：輪詢讓路，指令不必排在輪詢的 AppleEvent 後面。 */
let commandBusy = false
/** 每下一次指令就 +1。輪詢拿到的快照若跨過了指令，就是舊的，丟掉，免得鏡片閃回上一張。 */
let commandGen = 0
/** 指令一個接一個做，連按時順序才不會亂。 */
let commandChain: Promise<void> = Promise.resolve()

function rememberSnap(s: KeynoteSnapshot): void {
  lastSnap = s
  lastSnapAt = Date.now()
}
let lastBroadcast = ''

/**
 * 使用者在手機上點名指定的簡報。null 代表自動——跟著最前面／正在播放的那一份。
 *
 * 為什麼要有這個：開多份簡報是真實情況（主簡報＋備用＋參考資料），
 * 而「最前面那一份」不一定是等一下要講的。自動模式在按下播放時
 * 一定會切對，但上台前想先確認講稿時就需要能明確指定。
 */
let pinnedDeck: string | null = null
/** Keynote 目前開著哪些簡報。給手機端列出來選。 */
let documents: Array<{ name: string; slides: number }> = []
/** 上次看到的文件數。變了才重新列一次，不進高頻輪詢。 */
let lastDocCount = -1
/** 跟著舊版時的計數，用來低頻檢查現行版是否已經開了簡報。 */
let staleTicks = 0

// ── 語音跟隨 ───────────────────────────────────────────────────
/** 眼鏡端算好的斷行。對齊必須以行為單位，而斷行只有眼鏡端知道。 */
let followLines: string[] = []
/** 箭頭目前在第幾行。由 Mac 這邊維護，因為對齊需要「上次在哪」。 */
let followCursor = 0
/** 語音跟隨開關。關掉時連轉錄都不做，省電也省 BLE 頻寬。 */
let following = false
/** 眼鏡送上來的 PCM 緩衝。 */
const audioWindow = new AudioWindow()
/** 眼鏡回報的取樣率。第一次收到時記下來，之後照它走。 */
let audioSampleRate = 16_000
/** 同時間只跑一輪辨識。上一輪還沒回來就把這一輪丟掉——
 *  堆積起來只會讓箭頭愈追愈慢，丟掉反而永遠追著最新的聲音。 */
let transcribing = false
/** 是否已經記錄過音訊格式。只記第一包，不要洗版。 */
let audioSeen = false
/** 連續幾輪沒聽到聲音。用來判斷是「沒收到音」還是「對不上」。 */
let quietRounds = 0
/** 正在跑的 whisper 程序。關掉語音跟隨時要收掉，把 1.7 GB 還回去。 */
let whisperChild: ReturnType<typeof spawn> | null = null

/**
 * 演講計時起點（epoch ms）。null 表示還沒開始計時。
 *
 * 起點取「Keynote 開始播放」那一刻，而不是「眼鏡端選完模式」——
 * 選完模式到真正上台之間可能隔了好幾分鐘，用那個當起點會虛報。
 */
let playStartedAt: number | null = null

/**
 * 計時起點落地到檔案。
 *
 * agent 若在台上被 launchd 重啟（2026-09 實機 log 有 3 次未捕捉錯誤致死），
 * 記憶體裡的起點會歸零，下課倒數整場錯。重啟後若上次看到播放還在
 * NEW_SESSION_GAP 之內，就接回原本的起點——跟「誤按 Esc 馬上回去播」同一個規則。
 */
const STATE_FILE = `${process.env.HOME}/Library/Application Support/SlideCue/timer.json`
let timerSavedAt = 0

function saveTimer(force = false): void {
  const now = Date.now()
  if (!force && now - timerSavedAt < 5000) return
  timerSavedAt = now
  try {
    mkdirSync(dirname(STATE_FILE), { recursive: true })
    writeFileSync(STATE_FILE, JSON.stringify({ playStartedAt, lastPlayingSeen, mode }))
  } catch { /* 寫不進去只是少了重啟保護，不該影響上台 */ }
}

function restoreTimer(): void {
  try {
    const t = JSON.parse(readFileSync(STATE_FILE, 'utf8')) as { playStartedAt?: number | null; lastPlayingSeen?: number; mode?: ControlMode }
    // 存檔每 5 秒一次，所以容許的空窗要把這 5 秒加回去
    if (t.playStartedAt && t.lastPlayingSeen && Date.now() - t.lastPlayingSeen < NEW_SESSION_GAP_MS + 5000) {
      playStartedAt = t.playStartedAt
      // 已判定是同一場：把「上次看到播放」拉到現在，免得 syncTimer 的 30 秒門檻
      // 因為存檔延遲而把剛接回的起點又重設掉
      lastPlayingSeen = Date.now()
      if (t.mode === 'ring' || t.mode === 'manual') mode = t.mode
      log(`接回重啟前的計時（已講 ${elapsedSec()} 秒）`)
    }
  } catch { /* 沒有存檔就是新的一場 */ }
}

/**
 * Mac 在區網裡的穩定名稱。
 *
 * os.hostname() 在 macOS 上有時已經帶了 .local，直接再接一次會變成 .local.local，
 * 那個位址解不出來——而且失敗時完全沒有錯誤訊息，只是連不上。
 */
/**
 * 手機端要輸入的連線碼＝本機 IP 的最後一段。
 *
 * 為什麼只給最後一段：區網 IP 的前三段幾乎總是那幾種（家用路由器、
 * 企業網段、iPhone 熱點固定的 172.20.10），**真正因人而異的只有最後一段**。
 * 手機端把這個數字套進常見網段一起競速即可（見 glasses/src/host.ts）。
 *
 * 取第一張非 VPN、非回送、非 Tailscale 的 IPv4 介面。多張網卡同時連著時
 * （例如 Wi-Fi 加有線）不一定是預設路由那張——連不上時請改輸入完整 IP。
 */
function connectCode(): string | null {
  for (const [name, addrs] of Object.entries(networkInterfaces())) {
    if (name.startsWith('utun') || name === 'lo0') continue      // 跳過 VPN 與回送
    for (const a of addrs ?? []) {
      if (a.family !== 'IPv4' || a.internal) continue
      if (a.address.startsWith('100.')) continue                  // Tailscale 不是區網位址
      const last = a.address.split('.').pop()
      if (last) return last
    }
  }
  return null
}

function mdnsName(): string {
  const h = hostname()
  return h.endsWith('.local') ? h : `${h}.local`
}

function elapsedSec(): number {
  if (playStartedAt === null) return 0
  return Math.floor((Date.now() - playStartedAt) / 1000)
}

/**
 * HTTP 層。存在的理由只有一個：**讓「手機連不連得到這台 Mac」可以被單獨驗證**。
 *
 * WebSocket 失敗時什麼都看不到——不知道是網路不通、位址錯了、還是 agent 沒跑。
 * 有了這個端點，用手機瀏覽器開一下就知道，不必猜。
 */
const httpServer = createHttpServer((req, res) => {
  // 眼鏡端 app 是從 Even Hub 的來源載入的，探測時屬跨來源請求
  res.setHeader('Access-Control-Allow-Origin', '*')

  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({
      ok: true,
      app: 'slidecue-agent',
      deck: deckName,
      slides: deck.length,
      playing: playStartedAt !== null,
      clients: wss.clients.size,
      connectCode: connectCode(),
      follow: following,
      whisper: whisperEndpoint() ?? null,
      followLines: followLines.length,
      cursor: followCursor,
    }))
    return
  }

  // 其他路徑回一頁人看得懂的畫面，方便直接用手機瀏覽器確認
  const okDeck = deckName ? `已載入「${deckName}」${deck.length} 張` : '目前沒有開著的簡報'
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(`<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<body style="font:16px/1.7 -apple-system,sans-serif;padding:2rem;background:#111;color:#eee">
<h2 style="color:#7ee787">✓ 連得到 SlideCue agent</h2>
<p>${okDeck}</p>
<p>眼鏡端連線數：${wss.clients.size}</p>
<p style="color:#888;font-size:14px">看到這一頁，代表手機和這台 Mac 之間網路是通的。</p>
</body>`)
})

const wss = new WebSocketServer({ server: httpServer })

/**
 * 同一台裝置最多幾條連線。
 *
 * 眼鏡端連線時會同時對多個候選位址競速，所以短時間內有 2–3 條是正常的。
 * 但如果對面出了問題（實測過一次重連風暴，30 秒衝到 19 條），
 * agent 得自己擋下來——每條連線都要收到整份講稿，放任下去會被打死。
 * 一端的 bug 不該讓另一端跟著倒。
 */
const MAX_PER_PEER = 4

/**
 * 只服務第一個連上的裝置（Trust On First Use）。
 *
 * ## 這是在擋什麼
 *
 * agent 綁在 0.0.0.0，而且任何連上 :8788 的 WebSocket 都會**無條件收到整份講稿**。
 * 實測：從區網位址連進來，沒有任何認證，直接拿到 120 張、29,247 字的完整講稿。
 * 在醫院或研討會的公共 Wi-Fi 上，同網路的任何人都拿得走——而講稿裡有臨床個案。
 *
 * ## 為什麼預設開啟
 *
 * 一開始預設關閉，理由是「誤鎖會讓人在台上連不上」。但那個判斷只在
 * 開發者自己家裡成立——**公開發布後，使用者會在醫院、研討會、飯店的
 * 公共 Wi-Fi 上演講，而那裡有幾百個陌生人**，講稿裡可能有病人案例。
 *
 * 而且誤鎖的代價其實很小：斷線滿一分鐘就自動釋放，真的卡住也只要
 * 重開 app。相比之下，整份講稿被同網段的人拿走是不可逆的。
 *
 * 要關掉（例如多支手機輪流連同一台電腦）：
 *
 *   SLIDECUE_LOCK_PEER=0
 *
 * ## 為什麼有 60 秒的釋放窗
 *
 * 換 Wi-Fi、切熱點都會讓手機換 IP。鎖死的話使用者只能重啟 agent，
 * 而那是台上最不想做的事。斷線滿一分鐘就放開，讓新裝置能接手。
 */
const LOCK_PEER = process.env.SLIDECUE_LOCK_PEER !== '0'
const PEER_RELEASE_MS = 60_000
let trustedPeer: string | null = null
let trustedGoneAt = 0
/** 眼鏡全部離線後，延遲關閉語音跟隨的計時器。 */
let followOffTimer: ReturnType<typeof setTimeout> | null = null

/** 這個 IP 現在還有幾條開著的連線（不含 except）。 */
function openFrom(peer: string, except?: WebSocket): number {
  let n = 0
  for (const c of wss.clients) {
    if (c === except) continue
    if ((c as WebSocket & { peer?: string }).peer === peer && c.readyState === WebSocket.OPEN) n++
  }
  return n
}

wss.on('connection', (ws, req) => {
  const peer = req.socket.remoteAddress ?? '?'

  if (LOCK_PEER) {
    const now = Date.now()
    // 信任的裝置離線夠久了就放開，換網路的人才不會被鎖在門外
    // 信任的裝置只要還有任何一條連線開著，就不算離線——
    // Wi-Fi 抖動後舊的半開連線常比新連線晚關，不能拿「某一條關了」當離線。
    if (trustedPeer && trustedGoneAt && now - trustedGoneAt > PEER_RELEASE_MS && openFrom(trustedPeer) === 0) {
      log(`「${trustedPeer}」已離線超過一分鐘，解除鎖定`)
      trustedPeer = null
    }
    if (trustedPeer === null) {
      trustedPeer = peer
      trustedGoneAt = 0
      log(`已鎖定裝置 ${peer}（其他裝置將被拒絕；設定 SLIDECUE_LOCK_PEER=0 可關閉）`)
    } else if (trustedPeer !== peer) {
      log(`⚠️ 拒絕來自 ${peer} 的連線——目前只服務 ${trustedPeer}`)
      ws.close(1008, 'not the paired device')
      return
    } else {
      trustedGoneAt = 0
    }
  }
  const sameePeer = [...wss.clients].filter(c => (c as WebSocket & { peer?: string }).peer === peer)
  ;(ws as WebSocket & { peer?: string }).peer = peer

  if (sameePeer.length >= MAX_PER_PEER) {
    // 踢掉最舊的，留下最新的——最新的那條才是對面現在真正在用的
    const victim = sameePeer[0]
    log(`${peer} 連線過多（${sameePeer.length + 1}），關掉最舊的一條`)
    victim?.close(1013, 'too many connections')
  }

  log(`眼鏡端已連線：${peer}（目前 ${wss.clients.size} 條連線）`)
  if (followOffTimer) { clearTimeout(followOffTimer); followOffTimer = null }
  pushState(ws).catch(err => log(`送出現況失敗：${errMsg(err)}`))
  pushInfo(ws)
  pushBundle(ws)

  ws.on('message', raw => {
    let msg: ControlMessage
    try {
      msg = JSON.parse(String(raw))
    } catch {
      return
    }
    handleControl(msg).catch(err => log(`處理 ${msg.type} 失敗：${errMsg(err)}`))
  })

  ws.on('close', () => {
    // 同一台還有別條連線開著就不起算——只有全部斷光才算離線
    if (LOCK_PEER && peer === trustedPeer && openFrom(peer, ws) === 0) trustedGoneAt = Date.now()
    // 眼鏡全部離開（例如雙擊退出 app）時，語音跟隨沒人要了，把 1.7 GB 的模型收掉
    // 但不是一斷就關：Wi-Fi 抖一下、心跳自斷重連都會短暫歸零，每次都卸載重載模型
    // 會讓語音跟隨失效好一陣子。離線滿兩分鐘才收。
    if (wss.clients.size === 0 && following) {
      if (followOffTimer) clearTimeout(followOffTimer)
      followOffTimer = setTimeout(() => {
        followOffTimer = null
        if (wss.clients.size === 0 && following) stopFollowing('眼鏡端離線超過兩分鐘')
      }, 120_000)
    }
    log(`眼鏡端已離線：${peer}（剩 ${wss.clients.size} 條連線）`)
  })
  ws.on('error', err => log(`連線錯誤: ${(err as Error).message}`))
})

/**
 * 收到眼鏡送來的一段 PCM。
 *
 * 這支每 1.2 秒左右會被觸發一次辨識，所以裡面每一個判斷都在擋掉
 * 「沒必要的辨識」——關掉跟隨時、沒有講稿時、上一輪還沒回來時，
 * 全部直接返回。whisper 一輪 0.6 秒，堆起來箭頭就再也追不上了。
 */
async function handleAudio(msg: { pcm: string; sampleRate?: number }): Promise<void> {
  if (!following || !whisperEndpoint()) return
  if (followLines.length === 0) return
  if (msg.sampleRate && msg.sampleRate !== audioSampleRate) {
    audioSampleRate = msg.sampleRate
    log(`眼鏡回報取樣率 ${audioSampleRate} Hz`)
  }

  const chunk = Buffer.from(msg.pcm, 'base64')

  // 第一次收到聲音時把格式攤開來記一筆。
  // PCM 格式是整條管線唯一沒辦法在 Mac 上先驗的環節——如果 G2 送的
  // 不是 16 kHz/16-bit/單聲道，症狀會是「箭頭就是不動」，
  // 沒有這行 log 根本無從判斷是收音、格式、還是對齊出的問題。
  if (!audioSeen) {
    audioSeen = true
    let peak = 0
    for (let i = 0; i + 1 < chunk.length; i += 2) {
      peak = Math.max(peak, Math.abs(chunk.readInt16LE(i)))
    }
    log(`收到眼鏡音訊：每包 ${chunk.length} bytes，` +
        `以 16-bit 解讀的峰值 ${peak}（正常說話約 2000–20000；` +
        `接近 0 或貼著 32767 代表格式不是 16-bit LE）`)
  }

  const window = audioWindow.push(chunk)
  if (!window) return

  // 上一輪還在跑就跳過這一輪。追最新的聲音，不要排隊。
  if (transcribing) return
  transcribing = true
  try {
    const r = await listenOnce(window, followLines, followCursor, audioSampleRate)

    // 對齊過程要留下痕跡。箭頭不動有三種完全不同的原因——沒收到聲音、
    // 聽錯了、或對不上——沒有這些記錄就只能猜，而三者的修法不一樣。
    if (!r) {
      if (++quietRounds % 5 === 0) log(`語音跟隨：連續 ${quietRounds} 輪沒聽到聲音（麥克風太遠或環境太安靜）`)
      return
    }
    quietRounds = 0

    if (r.line < 0) {
      log(`語音跟隨：聽到「${r.heard.slice(0, 20)}」但對不上講稿（分數 ${r.score.toFixed(2)} 低於門檻），箭頭留在原地`)
      return
    }
    if (r.line === followCursor) return   // 沒動就不用送

    log(`語音跟隨：第 ${followCursor} → ${r.line} 行（分數 ${r.score.toFixed(2)}）｜聽到「${r.heard.slice(0, 20)}」`)
    followCursor = r.line
    broadcast({ type: 'cursor', line: r.line, score: r.score, heard: r.heard })
  } catch (err) {
    log(`辨識失敗：${(err as Error).message}`)
  } finally {
    transcribing = false
  }
}

async function handleControl(msg: ControlMessage): Promise<void> {
  if (msg.type === 'mode') {
    mode = msg.mode
    log(`翻頁模式切換為：${mode === 'ring' ? 'R1 戒指主控' : '自己翻（Spotlight／鍵盤）'}`)
    broadcastInfo()
    return
  }

  if (msg.type === 'lines') {
    // 換頁或重新斷行：箭頭回到開頭，緩衝清掉——
    // 留著上一張的聲音會讓新的一張一開始就對到奇怪的位置
    followLines = msg.lines
    followCursor = 0
    audioWindow.reset()
    return
  }

  if (msg.type === 'follow') {
    if (!msg.on) {
      stopFollowing('眼鏡端關閉')
      broadcastInfo()
      return
    }
    following = true
    log('語音跟隨：開啟')
    // 辨識模型常駐要吃 1.7 GB，而語音跟隨多數場合根本不會開。
    // 所以拖到真的要用才載入——第一次開啟會等幾十秒，
    // 那段時間箭頭照樣可以用手勢推，不影響上台。
    if (!whisperEndpoint()) void ensureWhisper()
    broadcastInfo()
    return
  }

  if (msg.type === 'pickDeck') {
    pinnedDeck = msg.name
    log(pinnedDeck ? `改為跟隨「${pinnedDeck}」` : '改為自動跟隨（最前面／播放中的那一份）')
    await refreshDeck(true)
    await pushStateToAll(true)
    broadcastInfo()
    return
  }

  if (msg.type === 'cursorAt') {
    // 講者用手勢推了箭頭。對齊要從新位置往前找，否則語音會把箭頭拉回舊處。
    if (msg.line >= 0 && msg.line < followLines.length) followCursor = msg.line
    return
  }

  if (msg.type === 'stats') {
    log(`眼鏡繪製耗時：${msg.text}`)
    return
  }

  if (msg.type === 'audio') {
    void handleAudio(msg)
    return
  }

  if (msg.type !== 'control') return

  if (msg.action === 'resync') {
    await refreshDeck(true)
    await pushStateToAll(true)
    return
  }

  if (msg.action === 'resetTimer') {
    playStartedAt = Date.now()
    log('計時已歸零')
    await pushStateToAll(true)
    return
  }

  // 翻頁指令只在戒指模式生效。手動模式下 Keynote 才是當家的，
  // 這裡若照做會和 Spotlight 打架，造成跳頁。
  if (mode !== 'ring') {
    log(`忽略 ${msg.action}：目前是手動模式，翻頁由 Keynote 主導`)
    return
  }

  const action = msg.action
  commandChain = commandChain.then(() => ringCommand(action)).catch(err => log(`戒指指令失敗：${errMsg(err)}`))
}

/**
 * 執行一下戒指翻頁。
 *
 * 快的關鍵（2026-09-27，原本每下 0.6–0.9 秒）：
 *  - 不先問 Keynote 第幾張，用輪詢留下的快照
 *  - 上一張的結果一定是「目前減一」，先通知眼鏡換稿，再叫 Keynote 翻
 *  - 下一步的指令與讀回張號合成一次 osascript（有動畫時張號不變，只能讀回）
 *  - 執行時輪詢讓路
 */
async function ringCommand(action: 'next' | 'prev'): Promise<void> {
  // 每一下都記「收到→做完」的耗時，才分得出是戒指漏送還是這邊慢
  const t0 = Date.now()
  const fresh = lastSnap && Date.now() - lastSnapAt < 1500 ? lastSnap : null
  const snap = fresh ?? await snapshot(pinnedDeck)
  if (!snap.open || !snap.playing) {
    log(`忽略 ${action}：Keynote 尚未開始播放`)
    return
  }
  commandBusy = true
  commandGen++
  let shownAt = 0
  try {
    if (action === 'next') {
      const { method, slide } = await advance(snap.slide, snap.total, pinnedDeck)
      if (method !== advanceMethod) {
        advanceMethod = method
        log(`戒指翻頁手段：${describeMethod(method)}`)
        broadcastInfo()
      }
      const after = { ...snap, slide: slide || snap.slide }
      rememberSnap(after)
      await pushStateToAll(true, after)
      shownAt = Date.now()
    } else {
      if (snap.slide <= 1) return
      const after = { ...snap, slide: snap.slide - 1 }
      rememberSnap(after)
      await pushStateToAll(true, after)     // 鏡片先換
      shownAt = Date.now()
      await retreat(snap.slide, pinnedDeck) // Keynote 隨後跟上
    }
  } finally {
    commandBusy = false
  }
  log(`戒指 ${action === 'next' ? '下一步' : '上一張'}：從第 ${snap.slide} 張，鏡片 ${shownAt - t0} ms，Keynote 完成 ${Date.now() - t0} ms${fresh ? '' : '（無快照，先問了一次）'}`)
}

/** 重新讀取整份講稿。換檔或使用者要求重同步時呼叫。 */
async function refreshDeck(force = false): Promise<void> {
  const snap = await snapshot(pinnedDeck)
  if (!snap.open) {
    if (deck.length) log('Keynote 已關閉所有簡報')
    deck = []
    deckName = ''
    return
  }
  if (!force && snap.name === deckName && deck.length === snap.total) return

  const notes = await allNotes(pinnedDeck)
  deck = buildDeck(notes)
  deckName = snap.name
  const withNotes = deck.filter(s => !s.inherited && s.notes).length
  const inherited = deck.filter(s => s.inherited).length
  log(`已載入「${deckName}」：${deck.length} 張，${withNotes} 張有自己的稿，${inherited} 張沿用前一張`)
  // 開著多個簡報時，跟的是「最前面」那一個。這件事必須講出來——
  // 否則使用者開了新檔卻看到舊稿，完全不知道是被另一個視窗擋住了。
  if (snap.docCount > 1) {
    log(`⚠︎ Keynote 開著 ${snap.docCount} 個簡報，目前跟隨最前面的「${deckName}」。` +
        `按下播放會自動切到你要講的那一份。`)
  }
  // 講稿一變就把整份補送給所有眼鏡端，離線備援才不會是舊的
  pushBundle()
}

function currentState(snap: KeynoteSnapshot): DeckState {
  const entry = deck[snap.slide - 1]
  return {
    type: 'deck',
    slide: snap.slide,
    total: snap.total,
    notes: entry?.notes ?? '',
    inherited: entry?.inherited ?? false,
    inheritIndex: entry?.inheritIndex ?? 1,
    inheritTotal: entry?.inheritTotal ?? 1,
    playing: snap.playing,
    deckName: snap.name,
    elapsedSec: elapsedSec(),
  }
}

/** 中斷超過這個秒數再開始，視為新的一場。 */
const NEW_SESSION_GAP_MS = 30_000

/** 上次看到 Keynote 在播放的時間點。 */
let lastPlayingSeen = 0

/**
 * 依播放狀態決定計時器該不該跑。
 *
 * 兩種情況要分開處理，差別只在中斷了多久：
 *  - 演講中誤按 Esc 又馬上回去播 → **不能**歸零，否則講者會失去時間感
 *  - 排練完隔幾分鐘才正式上台     → **應該**歸零，不然一開場就顯示已講 20 分鐘
 *
 * 以 30 秒為界，不需要使用者手動重設。
 */
function syncTimer(playing: boolean): void {
  if (!playing) return
  const now = Date.now()
  if (playStartedAt === null || now - lastPlayingSeen > NEW_SESSION_GAP_MS) {
    playStartedAt = now
    log('開始計時')
    // 開播是重讀講稿最好的時機：講者常在上台前臨時改附註，
    // 而那種修改往往不會改變張數，光靠「張數變了」偵測不到。
    refreshDeck(true).catch(err => log(`開播重讀講稿失敗：${errMsg(err)}`))
    saveTimer(true)
  }
  lastPlayingSeen = now
  saveTimer()
}

/**
 * 只送給單一連線（新連線接上時補一份現況）。
 *
 * 刻意不碰 lastBroadcast：那是廣播用的去重狀態，若在這裡一起更新，
 * 新連線就會「吃掉」一次廣播機會，害既有連線漏掉那次變化。
 */
async function pushState(ws: WebSocket): Promise<void> {
  const snap = await snapshot(pinnedDeck)
  syncTimer(snap.playing)
  send(ws, currentState(snap))
}

async function pushStateToAll(force = false, known?: KeynoteSnapshot): Promise<void> {
  // 輪詢迴圈已經問過一次就直接用，不要每 250ms 多開一個 osascript
  const snap = known ?? await snapshot(pinnedDeck)
  syncTimer(snap.playing)
  const state = currentState(snap)
  // 秒數放進去重鍵，計時器才會每秒動一次；毫秒級的變化不需要送。
  const key = `${state.slide}/${state.total}/${state.playing}/${state.deckName}/${state.elapsedSec}`
  if (!force && key === lastBroadcast) return
  lastBroadcast = key
  for (const ws of wss.clients) send(ws, state)
}

/**
 * 把整份講稿送給眼鏡端當離線備援。
 *
 * 連線建立時、以及每次重新載入講稿時都送一次。眼鏡端會存進手機，
 * 現場斷線時就靠這份撐完演講。
 */
function pushBundle(ws?: WebSocket): void {
  if (!deck.length) return
  const bundle: DeckBundle = {
    type: 'bundle',
    deckName,
    total: deck.length,
    scripts: deck.map(s => s.notes),
    inherited: deck.map(s => s.inherited),
    inheritIndex: deck.map(s => s.inheritIndex),
    inheritTotal: deck.map(s => s.inheritTotal),
  }
  const targets = ws ? [ws] : [...wss.clients]
  for (const t of targets) send(t, bundle)
}

function pushInfo(ws: WebSocket): void {
  const info: AgentInfo = {
    type: 'info',
    mode,
    advanceMethod,
    detail: describeMethod(advanceMethod),
    documents,
    pinnedDeck,
    activeDeck: deckName,
    keynoteApp: activeKeynoteId(),
    modelDownload: modelProgress.downloading ? modelProgress.percent : null,
  }
  send(ws, info)
}

function broadcastInfo(): void {
  for (const ws of wss.clients) pushInfo(ws)
}

function send(ws: WebSocket, payload: unknown): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload))
}

/** 送給所有連著的眼鏡端。 */
function broadcast(payload: unknown): void {
  for (const ws of wss.clients) send(ws, payload)
}

function describeMethod(m: AdvanceMethod): string {
  switch (m) {
    case 'showNext': return 'show next（保留動畫）'
    case 'keystroke': return '模擬右方向鍵（保留動畫）'
    case 'jump': return '直接跳頁（會略過動畫）'
    default: return '尚未使用'
  }
}

/** 主輪詢迴圈。播放中加快、閒置時降頻。 */
async function loop(): Promise<void> {
  for (;;) {
    try {
      if (commandBusy) { await delay(30); continue }
      const gen = commandGen
      let snap = await snapshot(pinnedDeck)
      // 讀的途中戒指下了指令：這份快照可能是翻頁前的，丟掉重讀
      if (gen !== commandGen || commandBusy) continue
      rememberSnap(snap)

      // 已經跟著舊版，但現行版那邊也開了東西——切過去。
      // 沒有這一段的話會卡在舊版：`!snap.open` 永遠不成立，
      // 下面那個切換分支就永遠不會執行。
      if (snap.open && activeKeynoteId() !== 'com.apple.Keynote' && ++staleTicks > 20) {
        staleTicks = 0
        const picked = await pickKeynote()
        if (picked.app === 'com.apple.Keynote' && picked.count > 0) {
          log('現行版 Keynote 也開著簡報了，切過去')
          snap = await snapshot(pinnedDeck)
        }
      }

      // 目前這個 Keynote 沒開東西時，換另一個問問看。
      // 這台機器上可能同時有新舊兩版，使用者開檔案時開到的是哪一個
      // 我們無從預測——只能問「誰手上有文件」。
      if (!snap.open) {
        const picked = await pickKeynote()
        if (picked.count > 0) {
          log(`改用 ${picked.app === 'com.apple.Keynote' ? 'Keynote（現行版）' : 'Keynote 14（舊版）'}，它開著 ${picked.count} 份`)
          snap = await snapshot(pinnedDeck)
        }
      }

      // 計時必須獨立於「有沒有眼鏡連著」。先前把它綁在推送流程裡，
      // 導致眼鏡中途才連上時，計時從「連上那一刻」起算而不是「開播那一刻」。
      syncTimer(snap.playing)
      if (snap.open && (snap.name !== deckName || deck.length !== snap.total)) {
        await refreshDeck()
      }
      if (!snap.open && deck.length) await refreshDeck()

      // 開關簡報時才重新列一次清單。這一步每多一份文件就多一次
      // AppleScript 來回，不該進高頻輪詢。
      // 數量沒變但換了一份（關 A 開 B）時清單也要更新
      if (snap.docCount !== lastDocCount || (snap.open && !documents.some(d => d.name === snap.name))) {
        lastDocCount = snap.docCount
        documents = snap.docCount > 0 ? await listDocuments() : []
        // 被點名的那一份關掉了就退回自動，不要卡在一個不存在的簡報上
        if (pinnedDeck && !documents.some(d => d.name === pinnedDeck)) {
          log(`「${pinnedDeck}」已關閉，改回自動跟隨`)
          pinnedDeck = null
          await refreshDeck(true)
        }
        broadcastInfo()
      }

      if (wss.clients.size > 0 && gen === commandGen && !commandBusy) await pushStateToAll(false, snap)
      await delay(snap.playing ? POLL_ACTIVE_MS : snap.open ? POLL_OPEN_MS : POLL_CLOSED_MS)
    } catch (err) {
      log(`輪詢錯誤: ${errMsg(err)}`)
      await delay(2000)
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

/**
 * 錯誤訊息只留最後一行。
 *
 * osascript 失敗時 message 會夾帶整段 AppleScript 原文，每次十幾行；
 * 輪詢錯誤一多，log 就膨脹到上百 MB（2026-09 實測 115MB）。真正有用的只有 execution error 那行。
 */
function errMsg(err: unknown): string {
  const m = err instanceof Error ? err.message : String(err)
  const lines = m.split('\n').map(l => l.trim()).filter(Boolean)
  return lines.find(l => l.includes('execution error')) ?? lines[lines.length - 1] ?? m
}

/**
 * log 太大就輪替。launchd 以 append 模式開檔，所以截斷後繼續寫是安全的。
 * 保留一份 .1 當上一輪的紀錄。
 */
const LOG_FILE = `${process.env.HOME}/Library/Logs/slidecue/agent.log`
const LOG_MAX_BYTES = 20 * 1024 * 1024

function rotateLog(): void {
  try {
    if (statSync(LOG_FILE).size < LOG_MAX_BYTES) return
    copyFileSync(LOG_FILE, `${LOG_FILE}.1`)
    truncateSync(LOG_FILE, 0)
    log('log 超過 20 MB，已輪替到 agent.log.1')
  } catch { /* 沒有這個檔（例如在終端機直接跑）就不用管 */ }
}

function log(msg: string): void {
  const t = new Date().toLocaleTimeString('zh-TW', { hour12: false })
  console.log(`[${t}] ${msg}`)
}

/** 找出可供手機連線的區網位址。 */
function lanAddresses(): string[] {
  const out: string[] = []
  for (const [name, addrs] of Object.entries(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === 'IPv4' && !a.internal) out.push(`${a.address}  (${name})`)
    }
  }
  return out
}

/**
 * 語音辨識模型放哪。
 *
 * 不放在 app 裡：模型 141 MB，而語音跟隨是選用功能，多數人可能根本不開。
 * 讓每個下載 app 的人先扛這 141 MB 不合理，所以第一次真的要用時才下載。
 */
const MODEL_DIR = `${process.env.HOME}/Library/Application Support/SlideCue/models`
const MODEL_NAME = 'ggml-base.bin'
const MODEL_URL = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${MODEL_NAME}`

/**
 * 為什麼用 base 而不是更大的模型。
 *
 * 實測比較 base(141MB) / small(465MB) / large-v3-turbo(1549MB) 三者，
 * **對齊分數完全相同（0.939），三句全部對到正確的行**，而 base 最快。
 *
 * 原因是這裡做的是「強制對齊」不是開放辨識：整份講稿已經當成 prompt 餵給
 * whisper，它只需要認出「講者現在念到哪」，容錯空間比一般語音辨識大得多。
 * 使用者若在吵雜環境需要更大的模型，可用 SLIDECUE_WHISPER_MODEL 指定。
 */
function modelPath(): string {
  return process.env.SLIDECUE_WHISPER_MODEL ?? `${MODEL_DIR}/${MODEL_NAME}`
}

/** 下載狀態，讓手機端看得到進度——141 MB 不說一聲會讓人以為當掉了。 */
let modelProgress: { downloading: boolean; percent: number } = { downloading: false, percent: 0 }

/**
 * 確保模型存在，沒有就下載。
 *
 * 下載到 .part 再改名：中途斷線留下的半個檔案，下次啟動會被當成完整模型，
 * whisper 讀到一半失敗而且錯誤訊息完全看不出是這個原因。
 */
async function ensureModel(): Promise<string | null> {
  const target = modelPath()
  if (existsSync(target)) return target
  if (process.env.SLIDECUE_WHISPER_MODEL) {
    log(`找不到指定的模型：${target}`)
    return null
  }

  mkdirSync(MODEL_DIR, { recursive: true })
  const tmp = `${target}.part`
  log(`語音跟隨需要辨識模型，開始下載（約 141 MB，只會下載這一次）…`)
  modelProgress = { downloading: true, percent: 0 }
  broadcastInfo()

  try {
    const res = await fetch(MODEL_URL)
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
    const total = Number(res.headers.get('content-length') ?? 0)
    let got = 0, lastLogged = 0

    const out = createWriteStream(tmp)
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      out.write(chunk)
      got += chunk.length
      if (total) {
        const pct = Math.floor((got / total) * 100)
        if (pct !== modelProgress.percent) {
          modelProgress = { downloading: true, percent: pct }
          if (pct - lastLogged >= 10) { lastLogged = pct; log(`  下載中… ${pct}%`); broadcastInfo() }
        }
      }
    }
    await new Promise<void>((r, j) => out.end(() => r()).on('error', j))
    renameSync(tmp, target)
    log('模型下載完成')
    return target
  } catch (err) {
    log(`模型下載失敗：${(err as Error).message}`)
    try { if (existsSync(tmp)) unlinkSync(tmp) } catch { /* 清不掉就算了 */ }
    return null
  } finally {
    modelProgress = { downloading: false, percent: 0 }
    broadcastInfo()
  }
}

/**
 * 準備語音辨識。
 *
 * whisper-server 與它的函式庫都包在 app 裡（約 5 MB），使用者不必安裝任何東西。
 * 只有模型是按需下載的。
 */
/**
 * 關掉語音跟隨並卸載模型。
 *
 * 集中在一處：眼鏡關開關、眼鏡全部離線，兩條路都要走同一套清理。
 */
function stopFollowing(reason: string): void {
  following = false
  audioWindow.reset()
  audioSeen = false
  quietRounds = 0
  whisperChild?.kill()
  whisperChild = null
  setWhisperEndpoint(null)
  log(`語音跟隨：關閉（${reason}）`)
}

/**
 * 同一時間只准一個準備流程。
 *
 * 沒有這道閘門時，下載模型途中關掉再打開跟隨，會有兩條下載同時寫同一個
 * .part，改名後留下壞模型；也會起兩個 whisper-server、只追蹤到最後一個。
 */
let whisperStarting: Promise<void> | null = null

function ensureWhisper(): Promise<void> {
  whisperStarting ??= startWhisper().finally(() => { whisperStarting = null })
  return whisperStarting
}

async function startWhisper(): Promise<void> {
  const fromEnv = process.env.SLIDECUE_WHISPER
  if (fromEnv) {
    setWhisperEndpoint(fromEnv)
    log(`語音辨識：使用指定的 ${fromEnv}`)
    return
  }

  const bin = whisperBinary()
  if (!bin) {
    log('語音辨識未啟用（找不到 whisper-server）')
    return
  }
  const model = await ensureModel()
  if (!model) {
    log('語音辨識未啟用（沒有辨識模型）')
    return
  }

  const logDir = `${process.env.HOME}/Library/Logs/slidecue`
  mkdirSync(logDir, { recursive: true })
  const whisperLog = openSync(`${logDir}/whisper.log`, 'a')
  const port = await freePort()

  // 準備期間使用者已經關掉跟隨的話，就不要起一個沒人用的 1.7 GB 程序
  if (!following) return
  whisperChild?.kill()
  const child = spawn(bin, [
    '-m', model, '--port', String(port), '-l', 'zh', '-t', '4', '--no-timestamps',
  ], { stdio: ['ignore', whisperLog, whisperLog], detached: false })

  whisperChild = child
  child.on('error', err => {
    log(`語音辨識未啟用（whisper-server 起不來：${err.message}）`)
    setWhisperEndpoint(null)
  })

  const url = `http://127.0.0.1:${port}`
  for (let i = 0; i < 120; i++) {
    await delay(500)
    // 等待期間被關掉或換掉了：立刻退出，讓下一次 ensureWhisper 能重新起一個
    if (whisperChild !== child) return
    try {
      const ctl = new AbortController()
      const t = setTimeout(() => ctl.abort(), 800)
      await fetch(`${url}/`, { signal: ctl.signal })
      clearTimeout(t)
      if (whisperChild !== child) return   // 等待期間被關掉或換掉了
      setWhisperEndpoint(url)
      log(`語音辨識就緒：${url}`)
      return
    } catch { /* 還在載入模型 */ }
  }
  log('語音辨識未啟用（whisper-server 等逾時，看 ~/Library/Logs/slidecue/whisper.log）')
}

/**
 * 找出 whisper-server 執行檔。
 *
 * 打包成 .app 後它就在 agent 旁邊的 whisper/ 目錄；開發時則沿用系統安裝的那份。
 */
function whisperBinary(): string | null {
  const candidates = [
    // 打包後：Contents/Resources/whisper/whisper-server
    `${dirname(process.argv[1] ?? '')}/whisper/whisper-server`,
    '/opt/homebrew/bin/whisper-server',
    '/usr/local/bin/whisper-server',
  ]
  return candidates.find(f => existsSync(f)) ?? null
}

/** 跟作業系統要一個確定沒人用的 port。 */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      srv.close(() => (port ? resolve(port) : reject(new Error('拿不到 port'))))
    })
    srv.on('error', reject)
  })
}

// 最後一道網：任何漏接的 Promise 錯誤只記 log，不讓整個 agent 死掉。
// Node 22 預設遇到 unhandled rejection 會直接結束程序，台上等於斷線加計時歸零。
process.on('unhandledRejection', err => log(`未捕捉的錯誤（已攔下）：${errMsg(err)}`))
process.on('exit', () => whisperChild?.kill())

rotateLog()
setInterval(rotateLog, 60 * 60 * 1000).unref()
// 心跳：眼鏡端靠它判斷連線是否已死（手機掉 Wi-Fi 時 close 事件可能晚幾十秒才來）
setInterval(() => broadcast({ type: 'hb' }), 5000)
restoreTimer()

httpServer.listen(PORT, '0.0.0.0')

log(`SlideCue agent 已啟動，監聽 :${PORT}`)
// 眼鏡端找電腦的順序：上次成功的位址 → 使用者輸入的連線碼（套進常見網段一起試）。
// 下面印出的 mDNS 名稱與 IP 是給人手動輸入或排錯用的，眼鏡端不會自己去猜。
// 手機端只要這三位數就能找到這台電腦——要講者上台前打完整 IP 是不合理的。
// 要一位講者在上台前打完整的 192.168.1.50 是不合理的。
const code = connectCode()
if (code) {
  log('')
  log(`  ┌──────────────────────────────┐`)
  log(`  │  連線碼   ${code.padEnd(19)}│`)
  log(`  │  在手機的 SlideCue 裡輸入     │`)
  log(`  └──────────────────────────────┘`)
  log('')
}
log(`  穩定位址   ws://${mdnsName()}:${PORT}`)
for (const addr of lanAddresses()) log(`  目前 IP    ws://${addr.split('  ')[0]}:${PORT}`)
log(`  測連通性   http://${mdnsName()}:${PORT}/health`)
if (LOCK_PEER) {
  log('只服務第一個連上的裝置；其他裝置會被拒絕（SLIDECUE_LOCK_PEER=0 可關閉）。')
} else {
  log('⚠️ 裝置鎖定已關閉——同一個網路上的任何裝置都能取得完整講稿。')
  log('   在公共場合演講時請勿關閉它。')
}

// 啟動時先讀一次講稿，但**絕不能讓它擋住 agent 起來**。
// 常駐執行時，第一次控制 Keynote 會觸發 macOS 的自動化授權對話框；
// 沒人回應就會拋 AppleEvent 逾時 (-1712)，未捕捉的話整個程序會掛掉、
// 然後被 launchd 反覆重啟。輪詢迴圈本來就會補上這次讀取。
void (async () => {
  try {
    await refreshDeck(true)
  } catch (err) {
    log(`啟動時讀取 Keynote 失敗（稍後會自動重試）：${(err as Error).message}`)
  }
  void loop()
})()
