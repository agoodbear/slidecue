/**
 * 翻頁手段。
 *
 * Keynote 可以「往下一頁」的方式，代價各不相同，這裡由好到壞排序，
 * 每次翻頁都依序嘗試，前一種失敗才往下退（不做事前探測，理由見 advance()）。
 *
 *  1. show next   —— AppleScript 原生指令，官方描述是「Advance one build or slide」，
 *                    會逐一播放動畫構件。這是唯一能保住 build 的做法。
 *  2. jump        —— show slide N+1，一定成功，但會直接跳過該張所有動畫。
 *
 * （曾有第三種：System Events 送右方向鍵。已拿掉——合成按鍵被系統丟掉時不報錯，
 *   沒有頁碼驗收就無從得知，戒指會按了沒反應。型別仍保留 'keystroke' 以相容舊訊息。）
 *
 * 實測記錄（2026-08-20，螢幕鎖定狀態）：
 *   show next 回報「沒有視窗 (-1708)」、keystroke 未送達 Keynote。
 *   兩者都可能只是鎖定螢幕造成，所以每次翻頁都重新嘗試，不快取結果。
 */

import { showSlide, showNextAndRead } from './keynote.ts'

export type AdvanceMethod = 'showNext' | 'keystroke' | 'jump' | 'none'

/**
 * 往下一頁（或下一個動畫構件）。每次都由好到壞依序嘗試，回傳實際用上的手段。
 *
 * ⚠️ 不再依賴事前探測。舊版只在「切到戒指模式」那一刻探測一次，
 * 而正常流程是先選模式、再按播放——探測時 Keynote 還沒在播，永遠回 'none'，
 * 結果戒指翻頁一律走 jump，所有動畫構件都被跳過（實機 log 三次全是「尚未探測」）。
 * 反過來播放中重連時又會真的探測，當著觀眾前進再退回，build 被重置。
 *
 * show next 若失敗會丟錯（例如 -1708），所以「沒報錯＝成功」在這裡是可靠的；
 * 不能用頁碼驗收，因為播放一個構件時頁碼本來就不會變。
 */
export async function advance(
  current: number, total: number, pinned: string | null = null,
): Promise<{ method: AdvanceMethod; slide: number }> {
  // show next 與讀回張號在同一次 osascript 完成，省一趟 AppleEvent 來回
  try {
    return { method: 'showNext', slide: await showNextAndRead(pinned) }
  } catch { /* 往下退到跳頁 */ }
  // 不退到 keystroke：合成按鍵被系統丟掉時不會報錯，戒指按了會毫無反應，
  // 比「跳頁略過動畫」更糟。show next 失敗就直接跳頁，至少一定有動。
  if (current >= total) return { method: 'jump', slide: current }
  await showSlide(current + 1, pinned)
  return { method: 'jump', slide: current + 1 }
}

/**
 * 回上一頁。
 *
 * 這裡一律用 show slide 直跳，不用 show previous：回上一頁時講者要的是
 * 「立刻回到那張的完整狀態」，逐格倒退動畫只會拖慢台上的節奏。
 */
export async function retreat(current: number, pinned: string | null = null): Promise<void> {
  if (current <= 1) return
  await showSlide(current - 1, pinned)
}
