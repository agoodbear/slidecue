/**
 * 音訊字幕探針。
 *
 * ## 要回答什麼
 *
 * 「戴著 AirPods 聽 podcast，字幕出現在 G2 上」這個構想，卡在一個沒人驗證過的前提：
 * **Even Hub 外掛是跑在 Even app 裡的一個 WebView，它到底能不能播音訊？**
 *
 * SDK 從頭到尾沒有任何音訊「輸出」API——只有顯示、麥克風輸入、IMU、相機、
 * 相簿、定位、儲存。所以唯一的可能是 HTML5 `<audio>`，而那從來沒人試過。
 *
 * iOS 也擋不到別的 app 正在播的聲音（`AudioInputSource` 只有 `glasses` 與 `phone`
 * 兩個麥克風來源），所以「自己當播放器」是唯一走得通的方向。這支就是驗證那個方向。
 *
 * ## 為什麼連字幕一起驗，而不只驗「有沒有聲音」
 *
 * 「能播」只是必要條件。真正要成立的是整條鏈：
 * 播放進度讀得到 → 對到逐字稿的時間軸 → 推到鏡片上 → **而且手機收進口袋後這些都還在動**。
 * 只驗第一步，後面三步照樣可能死，等於白測一輪。所以這支直接跑完整機制。
 *
 * ## 四個檢查點
 *
 * 1. `<audio>` 播不播得出來，聲音有沒有進到耳機
 * 2. `currentTime` 讀不讀得到（字幕全靠它對齊）
 * 3. 螢幕關掉、手機進口袋之後，聲音會不會停
 * 4. 背景狀態下鏡片字幕會不會繼續更新
 *
 * 第 4 點是最容易死的：iOS 會凍結背景網頁的計時器。所以畫面上一直顯示
 * 「上次更新在幾秒前」——那個數字如果在你解鎖後暴增，就代表被凍結過。
 *
 * 用法：dev server 起來後，手機 Even app 開發者模式 → 掃 QR 載入
 * `http://<Mac 區網 IP>:5173/audio-probe.html`。不打包、不上傳。
 */

import {
  waitForEvenAppBridge,
  CreateStartUpPageContainer,
  TextContainerProperty,
  TextContainerUpgrade,
} from '@evenrealities/even_hub_sdk'
import { wrapLines, LINE_HEIGHT } from './lines.ts'

interface Seg { start: number; end: number; text: string }

const SCREEN_W = 576
const SCREEN_H = 288
const PAD = 6
const TEXT_W = SCREEN_W - PAD * 2
const MAX_LINES = Math.floor((SCREEN_H - PAD * 2) / LINE_HEIGHT)

const CONTAINER_ID = 1
const CONTAINER_NAME = 'audioprobe'

const bridge = await waitForEvenAppBridge()

let segs: Seg[] = []
let state = 'idle'
let lastErr = ''
/** 每次 timeupdate 蓋一次時間戳。背景被凍結時這個值會停住，解鎖後差距就跳出來。 */
let lastTickAt = Date.now()
let tickCount = 0

const audio = new Audio('/demo.m4a')
audio.preload = 'auto'

function currentText(t: number): string {
  const s = segs.find(x => t >= x.start && t < x.end)
  return s ? s.text : '（句與句之間）'
}

function lensText(): string {
  const t = audio.currentTime
  const since = ((Date.now() - lastTickAt) / 1000).toFixed(1)
  const head = `${state}  ${t.toFixed(1)}s  上次更新 ${since}s 前  x${tickCount}`
  const body = lastErr
    ? wrapLines(`錯誤：${lastErr}`, TEXT_W)
    : wrapLines(currentText(t), TEXT_W)
  return [head, '', ...body].slice(0, MAX_LINES).join('\n')
}

// 沒接眼鏡時這裡會失敗。音訊與背景存活那兩題本來就不需要眼鏡，
// 所以失敗只記下來、不要讓整頁停在這裡。
let lensOk = false
try {
  await bridge.createStartUpPageContainer(
  new CreateStartUpPageContainer({
    containerTotalNum: 1,
    textObject: [
      new TextContainerProperty({
        xPosition: 0, yPosition: 0, width: SCREEN_W, height: SCREEN_H,
        paddingLength: PAD, borderWidth: 0,
        containerID: CONTAINER_ID, containerName: CONTAINER_NAME,
        isEventCapture: 1,
        content: '音訊字幕探針\n\n請在手機畫面按「開始播放」',
      }),
    ],
  }),
  )
  lensOk = true
} catch (e) {
  lastErr = `鏡片未連線（不影響音訊測試）：${e instanceof Error ? e.message : String(e)}`
}

/** 內容沒變就不送——每一次都是一趟藍牙來回，字幕逐行更新時這個很省。 */
let painted = ''
async function paint(): Promise<void> {
  const t = lensText()
  if (t === painted) return
  painted = t
  if (!lensOk) { paintPhone(); return }
  try { await bridge.textContainerUpgrade(new TextContainerUpgrade({
    containerID: CONTAINER_ID, containerName: CONTAINER_NAME, content: t,
  })) } catch (e) { /* 斷線時忽略，下一輪會補上 */ }
  paintPhone()
}

// ── 手機畫面 ────────────────────────────────────────────────────────────
const app = document.getElementById('app') ?? document.body

function paintPhone(): void {
  const t = audio.currentTime
  const since = ((Date.now() - lastTickAt) / 1000).toFixed(1)
  app.innerHTML = `
    <div style="font:15px/1.6 -apple-system,system-ui,sans-serif;padding:18px;max-width:640px">
      <h2 style="margin:0 0 2px;font-size:18px">音訊字幕探針</h2>
      <div style="color:#666;margin-bottom:16px;font-size:13px">驗證 Even Hub WebView 能不能播音訊，以及字幕能不能跟著播放進度走</div>
      <button id="go" style="width:100%;padding:16px;font-size:17px;font-weight:600;border:0;border-radius:12px;background:#0a7;color:#fff">
        ${state === 'playing' ? '暫停' : '開始播放'}
      </button>
      <div style="margin-top:16px;display:grid;grid-template-columns:auto 1fr;gap:6px 14px;font-variant-numeric:tabular-nums">
        <div style="color:#888">狀態</div><div><b>${state}</b></div>
        <div style="color:#888">播放進度</div><div>${t.toFixed(1)} / ${(audio.duration || 0).toFixed(1)} 秒</div>
        <div style="color:#888">字幕更新次數</div><div>${tickCount}</div>
        <div style="color:#888">上次更新</div><div>${since} 秒前</div>
        <div style="color:#888">螢幕狀態</div><div><b>${document.visibilityState}</b>（切換 ${visChanges} 次）</div>
        <div style="color:#888">鏡片</div><div>${lensOk ? '已連線' : '未連線（不影響本測試）'}</div>
        ${lastErr ? `<div style="color:#c33">訊息</div><div style="color:#c33">${lastErr}</div>` : ''}
      </div>
      <div style="margin-top:16px;padding:14px;background:#f5f5f5;border-radius:10px;min-height:60px">
        <div style="font-size:12px;color:#888;margin-bottom:6px">目前字幕</div>
        <div>${currentText(t)}</div>
      </div>
      <ol style="margin-top:18px;padding-left:20px;color:#555;font-size:13px;line-height:1.9">
        <li>按開始播放，確認 <b>AirPods 有沒有聲音</b></li>
        <li>看鏡片上字幕有沒有跟著念到的句子走</li>
        <li><b>把手機鎖起來放口袋，等 20 秒</b>，再看鏡片</li>
        <li>解鎖回來，看「上次更新」是不是暴增（暴增＝背景被凍結）</li>
      </ol>
    </div>`
  const b = document.getElementById('go')
  if (b) b.onclick = toggle
}

async function toggle(): Promise<void> {
  if (state === 'playing') { audio.pause(); return }
  try {
    // 播完或快播完就從頭來。實測踩過一次：接續播放時只剩 2 秒，
    // 鎖屏測試等於在「沒有音訊」的狀態下進行，而 iOS 的背景執行權正是靠音訊換來的。
    if (audio.ended || audio.currentTime > audio.duration - 5) audio.currentTime = 0
    // iOS 沒有使用者手勢就不准播，所以一定要掛在按鈕上。
    // 失敗時 play() 是 reject，不是丟例外到外面，所以要 await 才抓得到。
    await audio.play()
    lastErr = ''
  } catch (e) {
    lastErr = e instanceof Error ? `${e.name}: ${e.message}` : String(e)
  }
  void paint()
}

audio.addEventListener('play', () => { state = 'playing'; void paint() })
audio.addEventListener('pause', () => { state = 'paused'; void paint() })
audio.addEventListener('ended', () => { state = 'ended'; void paint() })
audio.addEventListener('error', () => {
  const err = audio.error
  lastErr = err ? `media error code ${err.code}` : 'unknown media error'
  state = 'error'
  void paint()
})
audio.addEventListener('timeupdate', () => {
  lastTickAt = Date.now()
  tickCount++
  void paint()
})

// ── 心跳回報 ────────────────────────────────────────────────────────────
// 背景是否存活，靠使用者盯著鏡片上的數字判斷太不可靠——鎖屏當下沒人看得到。
// 改成每 1.5 秒回報一次給 Mac，凍結時心跳自然斷掉，事後從斷點就讀得出來。
//
// 回報三個值就足以分辨失敗模式：
//   心跳沒斷            → 背景完全存活
//   心跳斷、恢復時 t 有前進 → JS 被凍結但音訊繼續播（字幕會停、聲音正常）
//   心跳斷、恢復時 t 沒動   → 整個 WebView 被暫停
const BEACON = `http://${location.hostname}:5174/`
let beatNo = 0

/**
 * 螢幕狀態。
 *
 * 前一輪測出「心跳沒斷」，但那只證明 JS 在跑，**沒有證明螢幕當時真的鎖著**——
 * 那部分只能採信口頭回報。鎖屏時 WebView 的 `visibilityState` 會變成 `hidden`，
 * 把它一起回報，就有機器證據可以確認測試條件成立。
 *
 * 另外掛上 Page Lifecycle 的 freeze/resume：Safari 支援情況不明，
 * 有收到就是額外資訊，沒收到也不影響 visibility 這條主線。
 */
let visChanges = 0
let lastVisAt = Date.now()
let lifecycle: string[] = []
document.addEventListener('visibilitychange', () => {
  visChanges++
  lastVisAt = Date.now()
})
for (const ev of ['freeze', 'resume', 'pagehide', 'pageshow']) {
  window.addEventListener(ev, () => { lifecycle.push(`${ev}@${new Date().toISOString().slice(11, 19)}`) })
}
setInterval(() => {
  const body = JSON.stringify({
    n: ++beatNo,
    wall: Date.now(),
    t: Number(audio.currentTime.toFixed(2)),
    state,
    ticks: tickCount,
    vis: document.visibilityState,
    visChanges,
    sinceVis: Math.round((Date.now() - lastVisAt) / 1000),
    lifecycle: lifecycle.slice(-4),
  })
  // keepalive 讓請求在頁面被凍結／切走的瞬間仍有機會送出去
  void fetch(BEACON, { method: 'POST', body, headers: { 'content-type': 'application/json' }, keepalive: true })
    .catch(() => { /* 收不到就算了，斷點本身就是資料 */ })
}, 1500)

// timeupdate 大約每 250ms 才一次，而「上次更新在幾秒前」要看得出凍結，
// 所以另外用計時器補畫面。這個計時器本身在背景被凍結時也會停——那正是我們要觀察的。
setInterval(() => { void paint() }, 500)

// 模擬器沒有手勢可按，用 ?auto=1 直接試播——真機上仍走按鈕，
// 因為 iOS 沒有使用者手勢一定會 reject。
if (new URLSearchParams(location.search).has('auto')) void toggle()

const res = await fetch('/demo.json')
segs = await res.json()
paintPhone()
void paint()
console.log('[audio-probe] 載入', segs.length, '句字幕')
