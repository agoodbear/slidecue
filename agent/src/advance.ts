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

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { showSlide, activeKeynoteId } from './keynote.ts'

const run = promisify(execFile)
/**
 * ⚠️ 不要在這裡硬編 bundle id。
 *
 * 這支檔案原本寫死 `com.apple.iWork.Keynote`（舊版），但 `keynote.ts` 是
 * **動態追蹤**目前開著文件的是哪一版（2026 起的 Creator Studio 版 bundle id
 * 是 `com.apple.Keynote`）。兩邊不一致的後果是：使用者用新版 Keynote 時，
 * 讀頁碼與講稿都正常，但 R1 戒指要翻頁時卻對著**沒有開文件的舊版**送指令，
 * 於是翻頁靜默失效——而且只在戒指模式才會發作，自己按鍵完全正常，很難聯想。
 */

export type AdvanceMethod = 'showNext' | 'keystroke' | 'jump' | 'none'

async function osa(script: string): Promise<string> {
  const { stdout } = await run('osascript', ['-e', script], { encoding: 'utf8' })
  return stdout.replace(/\n$/, '')
}

/** 嘗試 show next，成功回傳 true。 */
async function tryShowNext(): Promise<boolean> {
  try {
    await osa(`tell application id "${activeKeynoteId()}" to show next`)
    return true
  } catch {
    return false
  }
}

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
export async function advance(current: number, total: number, pinned: string | null = null): Promise<AdvanceMethod> {
  if (await tryShowNext()) return 'showNext'
  // 不退到 keystroke：合成按鍵被系統丟掉時不會報錯，戒指按了會毫無反應，
  // 比「跳頁略過動畫」更糟。show next 失敗就直接跳頁，至少一定有動。
  if (current >= total) return 'jump'
  await showSlide(current + 1, pinned)
  return 'jump'
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
