/**
 * SlideCue — Keynote 講稿即時同步到 G2。
 *
 * 開啟後直接顯示講稿，不再問任何問題——翻頁方式與演講時長都在手機端設定，
 * 而且會記住。原本在鏡片上做的兩層選單拿掉了：台上要的是「戴上就看到稿」，
 * 不是先做兩次選擇。
 *
 * 講稿以「行」為單位呈現，左側箭頭指著目前這一行。行是自己斷的（見 lines.ts），
 * 因為只有知道每行的內容，箭頭定位與日後的語音對齊才有依據。
 *
 * 連線斷掉時不會停擺：整份講稿事前已存進手機，會自動切到離線模式。
 */

import { waitForEvenAppBridge, AudioInputSource, type TextContainerUpgrade } from '@evenrealities/even_hub_sdk'
import { getTextWidth } from '@evenrealities/pretext'
import type { AgentMessage, DeckState, DeckBundle, ControlMode, RingInput } from './types.ts'
import { wrapLines, cursorColumn, linesPerContainer, scrollToShow } from './lines.ts'
import { coalesce } from './coalesce.ts'
import { prettyHost } from './host.ts'
import { setLang, detectLang, t, type Lang } from './i18n.ts'
import { nowCell, elapsedCell, countdownCell } from './clock.ts'
import { AgentLink } from './link.ts'
import { gestureOf, routeGesture } from './gestures.ts'
import { mountPhoneUi, updatePhoneStatus, updatePhoneSlide, updatePhoneProbe, updatePhoneFollow, updatePhoneDecks, updatePhoneModelDownload, updatePhoneAgentVersion } from './phone.ts'
import {
  cueStartUp, nowUpgrade, elapsedUpgrade, countdownUpgrade,
  pagenoUpgrade, cursorUpgrade, scriptUpgrade,
  SCRIPT_TEXT_W, SCRIPT_H, COUNTDOWN_TEXT_W, PAGENO_TEXT_W,
} from './ui.ts'

/** 建置時由 vite 從 app.json 注入。診斷時第一件要確認的事就是版本。 */
declare const __APP_VERSION__: string
const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '?'

/** 一頁塞得下幾行，由容器高度與韌體固定行高算出來。 */
const LINES_PER_PAGE = linesPerContainer(SCRIPT_H, 6)

/** 診斷 log 用的手勢名稱。放在檔案前段：事件可能在模組跑完前就進來，放後面會踩 TDZ。 */
const GESTURE_NAME: Record<number, string> = { 0: '單擊', 1: '上滑', 2: '下滑', 3: '雙擊', 9: '長按' }
/** 頁碼格暫時改顯示「請用滑的」提示，到這個時間為止。放前段理由同 GESTURE_NAME。 */
let swipeHintUntil = 0
const STORAGE_MODE = 'slidecue.mode'
/** 戒指模式的翻頁手勢（手勢／按鍵／混合）。 */
const STORAGE_RING_INPUT = 'slidecue.ringInput'
const STORAGE_DURATION = 'slidecue.duration'
const STORAGE_BUNDLE = 'slidecue.bundle'
/** 上次連上的 agent 位址。記住它，下次開場第一發就命中。 */
const STORAGE_HOST = 'slidecue.host'
/** 使用者輸入的連線碼（電腦上顯示的三位數）。 */
const STORAGE_CODE = 'slidecue.code'
/** 介面語言。沒存過就照手機的系統語言決定。 */
const STORAGE_LANG = 'slidecue.lang'
/** 語音跟隨是否開啟。記住上次的選擇。 */
const STORAGE_FOLLOW = 'slidecue.follow'

/** 統一的顯示資料，不管來自即時連線還是離線快取。 */
interface View {
  slide: number
  total: number
  notes: string
  inherited: boolean
  inheritIndex: number
  inheritTotal: number
}

const bridge = await waitForEvenAppBridge()

/** 預設「自己翻」——多數人用簡報器，這樣第一次開就能直接用。 */
let mode: ControlMode = 'manual'
/** 預設只認上下滑：實測單擊、長按、滑動混用最容易按錯。 */
let ringInput: RingInput = 'swipe'
let durationMin = 0
let connected = false
let deck: DeckState | null = null

/** 整份講稿的離線備援，由 agent 在連線時推送並存進手機。 */
let bundle: DeckBundle | null = null
/** 離線時自行維護的投影片編號。線上時由 Keynote 決定，不走這個。 */
let offlineSlide = 1
/** 上次成功連上的 agent 位址，開場時當作首選候選。 */
let rememberedHost: string | null = null
/** 使用者輸入的連線碼。記住的位址失效時（換場地）靠它重新找到電腦。 */
let connectCode: string | null = null
/** 介面語言，鏡片上的字也跟著它走。 */
let lang: Lang = 'zh'
/**
 * 語音跟隨：邊念邊讓箭頭自己往下走。
 *
 * 預設關閉。它會持續佔用眼鏡麥克風與 BLE 頻寬，而多數場合手勢就夠了；
 * 該由講者明確選擇要不要用，不該預設替他開。
 */
let follow = false
/** 最後一次收到的計時秒數。斷線後停在這裡，不歸零也不亂跳。 */
let lastElapsed = 0

/** 目前投影片講稿斷好的全部行。 */
let lines: string[] = ['']
/** 目前這一頁從第幾行開始。 */
let pageStart = 0
/** 箭頭指著第幾行（全域索引，不是頁內索引）。 */
let cursorLine = 0

// ── 讀回上次的設定與講稿，開場就能直接顯示 ────────────────────
await loadSettings()
await loadCachedBundle()

const link = new AgentLink({
  onMessage: handleAgentMessage,
  // 找到 agent 就記下來。下一場開場時它是第一順位，通常一發命中。
  onHostFound: url => {
    rememberedHost = url
    void bridge.setLocalStorage(STORAGE_HOST, url)
  },
  // 連不上時，讓手機端看得到「試過哪些位址」——否則只有一片空白可看。
  onProbe: info => updatePhoneProbe(info.tried, info.found),
  onRejected: () => updatePhoneStatus(false, bundle !== null, true),
  onConnectedChange: c => {
    const wasConnected = connected
    connected = c
    updatePhoneStatus(connected, bundle !== null)

    // 剛連上就把語音跟隨的狀態補送一次。
    // ⚠️ 沒有這一段會出現最糟的一種失敗：手機上的開關記得上次是「開」、
    // 畫面也確實打著勾，但 agent 從頭到尾不知道，麥克風也沒真的打開。
    // 使用者對著不會動的箭頭一直念，而畫面上每一個指示都說它是開的。
    // 一連上就報版本。診斷時第一個問題永遠是「你跑的是哪一版」，
    // 而那個問題以前只能用猜的。
    if (c) link.send({ type: 'stats', text: `[v${APP_VERSION}] 已連線` })

    if (c && follow) {
      link.send({ type: 'follow', on: true })
      link.send({ type: 'lines', slide: deck?.slide ?? offlineSlide, lines })
    }
    if (wasConnected && !c) {
      // 剛斷線：從最後已知的頁碼接手，講者不會感覺到跳頁
      offlineSlide = deck?.slide ?? offlineSlide
      // 清掉最後的線上狀態：斷線期間可能手動翻過，重連時就算 Keynote 回報
      // 同一張，也必須當成「換頁」重畫，不然畫面會停在離線時翻到的那張
      deck = null
      void renderAll()
    } else {
      void renderStatus()
    }
  },
}, rememberedHost, connectCode)

// ── 眼鏡端：一開啟就是講稿畫面 ────────────────────────────────
const result = await bridge.createStartUpPageContainer(
  cueStartUp(buildNow(), buildElapsed(), buildCountdown(), buildPageno(), buildCursor(), buildScript()),
)
if (result !== 0) console.error('建立啟動頁失敗，代碼：', result)

// ── 手機端：狀態與設定 ────────────────────────────────────────
mountPhoneUi({ mode, ringInput, durationMin, follow, lang, host: connectCode ?? prettyHost(rememberedHost) }, {
  onFollowChange: on => void setFollow(on),
  onDeckChange: name => link.send({ type: 'pickDeck', name }),
  // 切換語言後鏡片要立刻跟著換，不能等下一次翻頁。
  // 全部重畫是為了讓時間欄那三格也換掉——它們平常一分鐘才更新一次。
  onLangChange: l => {
    lang = l
    setLang(l)
    void bridge.setLocalStorage(STORAGE_LANG, l)
    lastPainted.clear()          // 清掉 diff 快取，否則內容「沒變」會被擋下來
    void renderAll()
  },
  // 使用者輸入連線碼（電腦上顯示的三位數）或完整位址。
  // 三位數會被展開成常見網段一起競速——要一位講者在上台前
  // 打完整的 192.168.1.50 是不合理的。
  onHostChange: input => {
    connectCode = input?.trim() || null
    rememberedHost = null                       // 會來改這裡，通常正是因為記住的那個連不上
    void bridge.setLocalStorage(STORAGE_CODE, connectCode ?? '')
    void bridge.setLocalStorage(STORAGE_HOST, '')
    link.useCode(connectCode)
  },
  onModeChange: m => {
    mode = m
    void bridge.setLocalStorage(STORAGE_MODE, m)
    link.setMode(m)
  },
  onRingInputChange: r => {
    ringInput = r
    void bridge.setLocalStorage(STORAGE_RING_INPUT, r)
  },
  onDurationChange: min => {
    durationMin = min
    void bridge.setLocalStorage(STORAGE_DURATION, String(min))
    void renderStatus()
  },
})
updatePhoneStatus(false, bundle !== null)

void link.connect()
link.setMode(mode)

// 上次關掉 app 時語音跟隨是開的，這次就真的把它打開——
// 而不是只讓開關看起來是開的。setFollow() 會實際去要麥克風，
// 失敗時也會把開關撥回去並說明原因。
if (follow) {
  follow = false          // 讓 setFollow 走完整的開啟流程
  void setFollow(true)
}

/**
 * 開關眼鏡麥克風。
 *
 * 收音刻意用眼鏡而不是手機或筆電：講者會走動，而只有眼鏡永遠在臉上。
 * 手機可能在口袋裡、筆電留在講台上，兩者在大場地都收不到。
 */
async function setFollow(on: boolean): Promise<void> {
  follow = on
  void bridge.setLocalStorage(STORAGE_FOLLOW, on ? '1' : '0')
  link.send({ type: 'follow', on })

  if (on) {
    const ok = await bridge.audioControl(true, AudioInputSource.Glasses)
    if (!ok) {
      // 麥克風拿不到就誠實關掉。留著 follow=true 只會讓使用者
      // 對著不會動的箭頭一直念，卻不知道問題出在哪。
      follow = false
      link.send({ type: 'follow', on: false })
      updatePhoneFollow(false, t().followMicFailed)
      return
    }
    // 開麥的當下把目前這張的斷行送過去，Mac 才有東西可以對齊
    link.send({ type: 'lines', slide: deck?.slide ?? offlineSlide, lines })
    updatePhoneFollow(true)
  } else {
    await bridge.audioControl(false)
    updatePhoneFollow(false)
  }
}

/** PCM 轉 base64。走既有的 WebSocket 送出，不另開通道。 */
function pcmToBase64(pcm: Uint8Array): string {
  let bin = ''
  // 一次轉太多會爆 call stack，分塊處理
  const CHUNK = 0x8000
  for (let i = 0; i < pcm.length; i += CHUNK) {
    bin += String.fromCharCode(...pcm.subarray(i, i + CHUNK))
  }
  return btoa(bin)
}

bridge.onEvenHubEvent(event => {
  // 麥克風送上來的音訊。這條路徑跟手勢無關，要先處理掉。
  if (event.audioEvent) {
    if (!follow) return
    const pcm = event.audioEvent.audioPcm
    if (pcm && pcm.length > 0) {
      link.send({ type: 'audio', pcm: pcmToBase64(pcm) })
    }
    return
  }

  const gesture = gestureOf(event)
  if (gesture === null) return
  lastGestureAt = Date.now()
  gestureCount++

  const action = routeGesture(gesture, {
    live: live(),
    mode,
    ringInput,
    cursorLine,
    lineCount: lines.length,
  })
  // 每一下都回報給 agent 記進 log：收到哪種手勢、從哪個欄位來、判成什麼動作。
  // 「收到 28 下只翻了 17 下」時，沒有這一行就無從知道另外 11 下去了哪裡。
  const src = event.sysEvent ? `sys${event.sysEvent.eventType ?? 0}` : `text${event.textEvent?.eventType ?? 0}`
  link.send({ type: 'stats', text: `手勢 ${GESTURE_NAME[gesture] ?? gesture}（${src}）→ ${action}｜${mode}/${ringInput}/${live() ? 'live' : 'offline'}` })

  // 提示期間成功滑了一下：頁碼要立刻回來，不能等提示自己消失
  if (action !== 'hintSwipe' && action !== 'none') swipeHintUntil = 0

  switch (action) {
    case 'exit': void bridge.shutDownPageContainer(1); break
    case 'sendNext': link.send({ type: 'control', action: 'next' }); break
    case 'sendPrev': link.send({ type: 'control', action: 'prev' }); break
    case 'localNext': stepSlideLocal(1); break
    case 'localPrev': stepSlideLocal(-1); break
    case 'cursorUp': moveCursor(-1); break
    case 'cursorDown': moveCursor(1); break
    case 'hintSwipe': flashSwipeHint(); break
  }
})

/**
 * 現在是不是「跟著 Keynote 走」。
 *
 * 光看 WebSocket 連著不夠：Keynote 在台上當掉或關檔時 agent 仍連著，
 * 但送來的是 0 張——那時要跟斷線一樣改用手機裡的快取，手勢也照離線規則走。
 */
function live(): boolean {
  return connected && deck !== null && deck.total > 0
}

/** 讀回上次的翻頁方式與演講時長。 */
async function loadSettings(): Promise<void> {
  try {
    const m = await bridge.getLocalStorage(STORAGE_MODE)
    if (m === 'ring' || m === 'manual') mode = m
    const ri = await bridge.getLocalStorage(STORAGE_RING_INPUT)
    if (ri === 'swipe' || ri === 'press' || ri === 'both') ringInput = ri
    const d = await bridge.getLocalStorage(STORAGE_DURATION)
    const n = Number(d)
    if (Number.isFinite(n) && n >= 0) durationMin = n
    const h = await bridge.getLocalStorage(STORAGE_HOST)
    if (h) rememberedHost = h
    const c = await bridge.getLocalStorage(STORAGE_CODE)
    if (c) connectCode = c
    // 沒存過就照手機的系統語言——第一次開就該是看得懂的語言，不必先去設定
    const savedLang = await bridge.getLocalStorage(STORAGE_LANG)
    lang = savedLang === 'en' || savedLang === 'zh' ? savedLang : detectLang()
    setLang(lang)
    follow = (await bridge.getLocalStorage(STORAGE_FOLLOW)) === '1'
  } catch {
    // 讀不到就用預設值，不該擋住開場
  }
}

/** 從手機讀回上次快取的整份講稿。 */
async function loadCachedBundle(): Promise<void> {
  try {
    const raw = await bridge.getLocalStorage(STORAGE_BUNDLE)
    if (!raw) return
    bundle = JSON.parse(raw) as DeckBundle
    offlineSlide = 1
    setScript(bundle.scripts[0] ?? '')
  } catch {
    // 快取壞掉不該擋住開場，當作沒有就好
    bundle = null
  }
}

function handleAgentMessage(msg: AgentMessage): void {
  if (msg.type === 'info') {
    updatePhoneDecks(msg.documents ?? [], msg.pinnedDeck ?? null, msg.activeDeck ?? '')
    updatePhoneModelDownload(msg.modelDownload ?? null)
    updatePhoneAgentVersion(msg.agentVersion)
  }
  if (msg.type === 'cursor') {
    setCursorLine(msg.line)
    return
  }
  if (msg.type === 'bundle') {
    // 先放進記憶體：本場演講的離線備援立刻就生效，不必等寫入成功
    bundle = msg
    // 再寫進手機，讓備援跨場次留存。大型簡報可能超過儲存上限，
    // 失敗要講出來——默默失敗會讓人以為有備援其實沒有。
    const json = JSON.stringify(msg)
    void bridge
      .setLocalStorage(STORAGE_BUNDLE, json)
      .then(ok => {
        if (!ok) console.warn(`[cache] 講稿快取寫入失敗（${json.length} bytes），跨場次備援不可用`)
      })
      .catch(err => console.warn('[cache] 講稿快取寫入例外', err))
    return
  }

  if (msg.type !== 'deck') return
  lastElapsed = msg.elapsedSec

  // Keynote 關檔或當掉：agent 仍連著但回報 0 張。改用手機快取接手，
  // 不能把空講稿畫上去——頁碼走快取、講稿卻顯示「沒有講稿」只會讓講者更慌。
  if (msg.total === 0) {
    if (deck) {
      offlineSlide = deck.slide
      deck = null
      setScript(bundle?.scripts[offlineSlide - 1] ?? '')
      void renderAll()
    } else {
      void renderStatus()
    }
    updatePhoneSlide(0, 0, '')
    return
  }

  const prev = deck
  deck = msg

  const slideChanged =
    !prev || prev.slide !== msg.slide || prev.deckName !== msg.deckName || prev.notes !== msg.notes

  if (slideChanged) {
    setScript(msg.notes)
    void renderAll()
  } else {
    // 沒換頁也要更新：計時器每秒都在動
    void renderStatus()
  }
  updatePhoneSlide(msg.slide, msg.total, msg.notes)
}

/** 換一張投影片：重新斷行，箭頭回到第一行。 */
function setScript(notes: string): void {
  lines = wrapLines(notes || t().lensNoScript, SCRIPT_TEXT_W)
  cursorLine = 0
  pageStart = 0
  // 斷行是這一端用實際字寬算出來的，Mac 無從得知；
  // 但語音對齊必須以行為單位才能指揮箭頭，所以要送過去。
  if (follow) link.send({ type: 'lines', slide: deck?.slide ?? offlineSlide, lines })
}

/** 箭頭直接跳到某一行——語音跟隨用，與手勢的相對移動不同。 */
function setCursorLine(line: number): void {
  if (line < 0 || line >= lines.length || line === cursorLine) return
  cursorLine = line
  applyScroll()
}

/**
 * 移動箭頭。箭頭離開目前這一頁時才跟著翻頁，
 * 且新頁把該行擺在最上面——講者要看的是接下來的內容，不是已經念過的。
 */
function moveCursor(delta: number): void {
  const next = cursorLine + delta
  if (next < 0 || next >= lines.length) return
  cursorLine = next
  applyScroll()
  // 語音跟隨開著時，讓 Mac 知道講者手動推過箭頭，對齊才會從新位置往前找
  if (follow) link.send({ type: 'cursorAt', line: cursorLine })
}

/**
 * 依箭頭位置決定要不要捲動，然後畫最省的那一種。
 *
 * 沒捲動時只重畫箭頭一個容器（115ms）；捲動了才連講稿一起重畫。
 */
function applyScroll(): void {
  const before = pageStart
  pageStart = scrollToShow(cursorLine, pageStart, lines.length, LINES_PER_PAGE)
  if (pageStart === before) void renderCursor()
  else void renderAll()
}

/** 離線時自行推進投影片。 */
function stepSlideLocal(delta: number): void {
  if (!bundle) return
  const next = offlineSlide + delta
  if (next < 1 || next > bundle.total) return
  offlineSlide = next
  setScript(bundle.scripts[next - 1] ?? '')
  void renderAll()
}

/** 目前該顯示什麼——線上看 Keynote，離線看快取。 */
function currentView(): View | null {
  if (connected && deck && deck.total > 0) {
    return {
      slide: deck.slide,
      total: deck.total,
      notes: deck.notes,
      inherited: deck.inherited,
      inheritIndex: deck.inheritIndex,
      inheritTotal: deck.inheritTotal,
    }
  }
  if (bundle) {
    const i = offlineSlide - 1
    return {
      slide: offlineSlide,
      total: bundle.total,
      notes: bundle.scripts[i] ?? '',
      inherited: bundle.inherited[i] ?? false,
      inheritIndex: bundle.inheritIndex[i] ?? 1,
      inheritTotal: bundle.inheritTotal[i] ?? 1,
    }
  }
  return null
}

/**
 * 「現在」欄。斷線時讓位給警示——那一刻知道連線掉了，比知道幾點重要得多。
 * 用 ■ 而不是 ✕：實測 ✕(U+2715) 不在 G2 字型裡，會被靜默跳過。
 */
function buildNow(): string {
  if (!connected) return bundle ? '■ 離線' : '■ 未連線'
  return nowCell()
}

/** 「授課」欄。 */
function buildElapsed(): string {
  // lastElapsed 每收到一則 deck 就更新；Keynote 關檔時 deck 會被清成 null，不能靠它
  return elapsedCell(lastElapsed)
}

/** 「下課倒數」欄。 */
function buildCountdown(): string {
  return countdownCell(
    lastElapsed,
    durationMin,
    COUNTDOWN_TEXT_W,
  )
}

/**
 * 右上角：頁碼，以及只在特殊情況出現的位置指示。
 *
 * 指示會讓這一欄變長（`183/183 ▷12/15 9/9` 實測 177px，遠超欄寬），
 * 所以由寬到窄逐級退讓，頁碼本身永遠保留。
 */
/** 戒指把滑動誤判成按：頁碼格閃一下提示，1.2 秒後自動換回頁碼。 */
function flashSwipeHint(): void {
  swipeHintUntil = Date.now() + 1200
  void paint('pageno', buildPageno(), pagenoUpgrade)
  setTimeout(() => void paint('pageno', buildPageno(), pagenoUpgrade), 1250)
}

function buildPageno(): string {
  if (Date.now() < swipeHintUntil) return t().lensSwipeHint
  const view = currentView()
  const page = view ? `${view.slide}/${view.total}` : '—'

  // marks 的順序就是取捨順序：空間不夠時從後面砍。
  // 講稿分頁排在前面，因為它代表「這張還有沒念到的內容」——
  // 那是講者當下真正需要知道的；「沿用前一張」只是解釋為什麼稿沒變。
  const marks: string[] = []

  // 這張講稿長到一頁放不下。
  //
  // 用括號而不是「稿」字：**實測「稿」不在 G2 的字型裡，會被靜默跳過**
  // （模擬器上「現在」「授課」「分」都正常顯示，只有「稿」消失），
  // 於是又退回「6/120 1/2」兩組數字並排、看不出誰是誰的狀態。
  // 括號是 ASCII，一定畫得出來，而且不需要翻譯。
  const totalPages = Math.ceil(lines.length / LINES_PER_PAGE)
  const thisPage = Math.floor(pageStart / LINES_PER_PAGE) + 1
  if (totalPages > 1) marks.push(`(${thisPage}/${totalPages})`)

  // 沿用前一張的稿：告訴講者稿沒丟，只是還在同一段。
  // 用 ▷ 而不是 ▸：實測 ▸(U+25B8) 不在 G2 韌體字型裡，會被靜默跳過。
  if (view?.inherited) marks.push(`▷${view.inheritIndex}/${view.inheritTotal}`)

  // 由多到少試，塞得下哪個算哪個
  for (let n = marks.length; n > 0; n--) {
    const candidate = [page, ...marks.slice(0, n)].join(' ')
    if (getTextWidth(candidate) <= PAGENO_TEXT_W) return candidate
  }
  // 連一個標記都塞不下時，講稿分頁比「沿用前一張」更該讓講者知道——
  // 它代表「這張還有沒念到的內容」。退成裸數字再試一次。
  if (totalPages > 1) {
    const bare = `${page} (${thisPage}/${totalPages})`
    if (getTextWidth(bare) <= PAGENO_TEXT_W) return bare
  }
  return page
}

/** 左側箭頭欄：靠換行把箭頭推到目前這一行。 */
function buildCursor(): string {
  return cursorColumn(cursorLine - pageStart, LINES_PER_PAGE)
}

/** 講稿本體：目前這一頁的行。 */
function buildScript(): string {
  return lines.slice(pageStart, pageStart + LINES_PER_PAGE).join('\n')
}

/**
 * 每個容器最後一次真正送出去的內容。
 *
 * 每一次 textContainerUpgrade 都是一趟藍牙來回，而且是排隊的。
 * 原本移動一次箭頭要送六個容器——其中五個內容根本沒變，
 * 包含整段講稿那一大包。台上的體感就是「按下去之後等一下才動」。
 */
const lastPainted = new Map<string, string>()

/**
 * 內容變了才送。
 *
 * 這是整個顯示層唯一的出口，所有更新都走這裡，
 * 不必在每個呼叫端各自判斷。
 */
async function paint(
  key: string,
  text: string,
  make: (t: string) => TextContainerUpgrade,
): Promise<void> {
  if (lastPainted.get(key) === text) return
  lastPainted.set(key, text)
  const t0 = Date.now()
  await bridge.textContainerUpgrade(make(text))
  recordPaint(key, Date.now() - t0)
}

/**
 * 每個容器的繪製耗時統計。
 *
 * 「反應有點慢」沒辦法靠讀程式碼修——藍牙來回實際要多久，
 * 只有真機知道。這份統計會回報給 Mac 記進 log，
 * 之後就能對著數字調，而不是猜。
 */
const paintStats = new Map<string, { n: number; total: number; max: number }>()
let statsSentAt = 0
/**
 * 這段期間收到幾個手勢。
 *
 * 沒有這個數字，繪製次數就無從解讀——「畫了 3 次」到底是好是壞，
 * 完全取決於使用者滑了 3 下還是 30 下。診斷抖動時這是最關鍵的比值。
 */
let gestureCount = 0


function recordPaint(key: string, ms: number): void {
  const st = paintStats.get(key) ?? { n: 0, total: 0, max: 0 }
  st.n++
  st.total += ms
  st.max = Math.max(st.max, ms)
  paintStats.set(key, st)

  // 每 20 秒回報一次。太頻繁會反過來佔用頻寬，正是我們要修的問題。
  const now = Date.now()
  if (now - statsSentAt < 20_000) return
  statsSentAt = now
  const summary = [...paintStats.entries()]
    .map(([k, v]) => `${k} ${v.n}次 平均${Math.round(v.total / v.n)}ms 最久${v.max}ms`)
    .join('｜')
  link.send({ type: 'stats', text: `[v${APP_VERSION}] 手勢${gestureCount}次｜${summary || '無繪製'}` })
  paintStats.clear()
  gestureCount = 0
}

/**
 * 只重畫箭頭。
 *
 * 手勢移動箭頭時走這一條：同一頁裡講稿一個字都沒變，
 * 沒有理由把整段文字重送一次。翻頁時 renderScript() 會補上。
 */
function renderCursor(): Promise<void> {
  return coalesce('cursor', () => paint('cursor', buildCursor(), cursorUpgrade))
}

/** 講稿本體與頁碼。只有換頁或換投影片時才需要。 */
async function renderScript(): Promise<void> {
  await paint('script', buildScript(), scriptUpgrade)
  await paint('pageno', buildPageno(), pagenoUpgrade)
}

/** 三個時間欄。內容相同的話一包都不會送出去。 */
/** 最後一次手勢的時間。滑動當下要把藍牙讓給箭頭。 */
let lastGestureAt = 0
/** 手勢後多久內不更新時間欄。一秒足夠讓一串連續滑動走完。 */
const GESTURE_QUIET_MS = 1000

async function renderStatus(): Promise<void> {
  // 正在滑動就先不畫時間。時間晚一秒更新沒人會發現，
  // 但箭頭慢一拍講者立刻就感覺得到——藍牙頻寬要優先給箭頭。
  if (Date.now() - lastGestureAt < GESTURE_QUIET_MS) return

  // 三個時間欄彼此獨立，一起送出去而不是排隊等——
  // 串行等待時，最後一欄要等前兩趟藍牙都回來才開始。
  await Promise.all([
    paint('now', buildNow(), nowUpgrade),
    paint('elapsed', buildElapsed(), elapsedUpgrade),
    paint('countdown', buildCountdown(), countdownUpgrade),
  ])
}

function renderAll(): Promise<void> {
  // 換頁要送六個容器、將近一秒。連續滑動跨頁時同樣會排隊，
  // 所以走一樣的合併機制。
  return coalesce('all', async () => {
    await renderScript()
    await paint('cursor', buildCursor(), cursorUpgrade)
    await renderStatus()
  })
}
