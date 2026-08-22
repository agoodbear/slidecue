/**
 * 時間顯示。
 *
 * 每一段時間都帶中文標籤，講者不必記符號代表什麼——台上沒有時間想
 * 「▽ 是倒數還是已過」。
 *
 * 但標籤有寬度代價。左上可用寬度只有 480px，實測（@evenrealities/pretext）：
 *   「現在時間 15:55  授課時間 8:42  距離下課 21:18」+ 兩個指示 = 525px 爆版
 *   「現在 15:55  授課 8:42  下課倒數 21:18」   + 兩個指示 = 445px 安全
 * 所以標籤取兩字為主，只有「下課倒數」值得多兩個字——那是最需要一眼看懂的。
 *
 * G2 只有 16 級綠、沒有顏色可用，所以時間快到只能靠進度條表達。
 * 進度條與所有符號都只用官方設計指南列為可用的字元（▇ ▁）——
 * 字型裡沒有的字元會被**靜默跳過**，不報錯、直接消失，emoji 尤其危險。
 */

import { getTextWidth } from '@evenrealities/pretext'
import { t } from './i18n.ts'

/** 剩餘時間低於這個秒數時開始出現進度條。 */
const WARN_SEC = 5 * 60

/**
 * 進度條格數。
 *
 * 實測每格 20px：10 格佔 198px 會爆版，6 格在單欄配置下仍超出，
 * 收到 4 格——「下課倒數 4:32 ▇▇▇▁」實測 210px，剛好進得了 216px 的欄位。
 */
const BAR_CELLS = 4

/** 目前時刻，24 小時制 `HH:MM`。 */
export function clockNow(now: Date = new Date()): string {
  const h = String(now.getHours()).padStart(2, '0')
  const m = String(now.getMinutes()).padStart(2, '0')
  return `${h}:${m}`
}

/**
 * 把秒數格式化成分鐘為單位的粗略時間。
 *
 * ## 為什麼不顯示秒
 *
 * 顯示到秒表示這個欄位**每秒都會變**，而每一次更新都是一趟藍牙重繪——
 * 實測「授課」234ms、「下課倒數」378ms，加起來每秒佔掉 612ms。
 * 藍牙有六成以上的時間都在畫秒數，講者滑動鏡腿時，箭頭的重繪（115ms）
 * 得跟它們搶頻寬，實機上就是整段講稿劇烈抖動。
 *
 * 而那些秒數根本沒人在看：台上要知道的是「講了一小時又兩分鐘」、
 * 「還剩五十八分鐘」，不是精確到秒。所以平常只到分鐘，一分鐘才更新一次。
 * 只有最後五分鐘才切回秒——那時候秒數才真正有意義，而那時講者
 * 通常也已經在收尾，不會一直滑動。
 */
export function coarse(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec))
  const hrs = Math.floor(s / 3600)
  const mins = Math.floor((s % 3600) / 60)
  if (hrs > 0) return `${hrs}:${String(mins).padStart(2, '0')}`
  return `${mins} ${t().lensMinute}`
}

/** 把秒數格式化成 `M:SS`；滿一小時才顯示 `H:MM:SS`。只在最後五分鐘用。 */
export function duration(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec))
  const hrs = Math.floor(s / 3600)
  const mins = Math.floor((s % 3600) / 60)
  const secs = s % 60
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
  }
  return `${mins}:${String(secs).padStart(2, '0')}`
}

/** 剩餘時間的視覺化進度條。剩越少，亮格越少。 */
function bar(remainingSec: number): string {
  const ratio = Math.max(0, Math.min(1, remainingSec / WARN_SEC))
  const filled = Math.round(ratio * BAR_CELLS)
  return '▇'.repeat(filled) + '▁'.repeat(BAR_CELLS - filled)
}

/**
 * 組出倒數區塊。
 *
 * @param elapsedSec 已經講了幾秒
 * @param durationMin 預定時長（分鐘）；0 代表不倒數
 */
export function countdown(elapsedSec: number, durationMin: number): string {
  if (durationMin <= 0) return ''

  const remaining = durationMin * 60 - elapsedSec

  // 超時：改成顯示超了多久，這是講者最需要立刻知道的事。
  // 超時了就顯示到秒——那個當下每一秒都算數。
  if (remaining < 0) return `${t().lensOvertime} ${duration(-remaining)}`

  // 進入最後五分鐘才拉出進度條並顯示到秒，平常畫面保持乾淨、藍牙也省下來
  if (remaining <= WARN_SEC) return `${t().lensCountdown} ${duration(remaining)} ${bar(remaining)}`

  return `${t().lensCountdown} ${coarse(remaining)}`
}

/** 「現在」欄的內容。 */
export function nowCell(now: Date = new Date()): string {
  return `${t().lensNow} ${clockNow(now)}`
}

/** 「授課」欄的內容。 */
export function elapsedCell(elapsedSec: number): string {
  return `${t().lensElapsed} ${coarse(elapsedSec)}`
}

/**
 * 「下課倒數」欄的內容，保證不超過欄寬。
 *
 * 這一欄的長度最不受控：帶進度條時比平常寬一倍以上。塞不下時先丟掉
 * 進度條——那只是視覺輔助，數字本身才是講者真正要看的。
 *
 * @param availWidth 欄位可用文字寬度
 */
export function countdownCell(
  elapsedSec: number,
  durationMin: number,
  availWidth: number,
): string {
  const full = countdown(elapsedSec, durationMin)
  if (!full || getTextWidth(full) <= availWidth) return full

  // 帶進度條時整串會變長。先縮標籤而不是先丟進度條——
  // 進入最後五分鐘後，那條逐格熄滅的進度條比「下課」兩個字有用得多。
    // 用目前語言的長標籤換短標籤，不能寫死中文——英文介面的長標籤是
    // "Time left"，正規表示式對不上就永遠不會縮，於是直接跳到「丟掉進度條」，
    // 結果英文使用者在最後五分鐘看不到那條逐格熄滅的進度條。
    const long = t().lensCountdown
    const shortLabel = full.startsWith(long)
      ? t().lensCountdownShort + full.slice(long.length)
      : full
  if (getTextWidth(shortLabel) <= availWidth) return shortLabel

  const noBar = shortLabel.replace(/\s*[▇▁]+$/, '')
  if (getTextWidth(noBar) <= availWidth) return noBar

  // 連文字都塞不下：捨棄標籤，只留時間。這是最後手段。
  return noBar.replace(/^[^\d]+/, '')
}
