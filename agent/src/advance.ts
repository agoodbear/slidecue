/**
 * 翻頁手段。
 *
 * Keynote 有三種可以「往下一頁」的方式，代價各不相同，這裡由好到壞排序，
 * 啟動時自動探測哪一種真的能用，並在失敗時往下退。
 *
 *  1. show next   —— AppleScript 原生指令，官方描述是「Advance one build or slide」，
 *                    會逐一播放動畫構件。這是唯一能保住 build 的做法。
 *  2. keystroke   —— 用 System Events 送右方向鍵，行為和真人按鍵完全一致，同樣保住 build。
 *                    需要輔助使用權限，而且螢幕鎖定時 macOS 會丟棄合成事件。
 *  3. jump        —— show slide N+1，一定成功，但會直接跳過該張所有動畫。
 *
 * 實測記錄（2026-08-20，螢幕鎖定狀態）：
 *   show next 回報「沒有視窗 (-1708)」、keystroke 未送達 Keynote。
 *   兩者都可能只是鎖定螢幕造成，解鎖後需重新探測，因此探測結果不做快取。
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { showSlide, snapshot, activeKeynoteId } from './keynote.ts'

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

/** 螢幕是否鎖定。鎖定時合成按鍵一定無效，可以直接跳過 keystroke 這條路。 */
export async function screenLocked(): Promise<boolean> {
  try {
    const out = await osa(`
      do shell script "python3 -c 'import Quartz;d=Quartz.CGSessionCopyCurrentDictionary();print(bool(d.get(\\"CGSSessionScreenIsLocked\\")))'"
    `)
    return out.trim() === 'True'
  } catch {
    return false
  }
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

/** 嘗試送右方向鍵給 Keynote，成功回傳 true。 */
async function tryKeystroke(): Promise<boolean> {
  try {
    await osa(`tell application "System Events" to tell process "Keynote" to key code 124`)
    return true
  } catch {
    return false
  }
}

/**
 * 探測目前哪一種翻頁手段真的有效。
 *
 * 判定方式不是「指令有沒有報錯」，而是「投影片有沒有真的動」——
 * 稍早踩過的坑：合成按鍵不會報錯，但事件被系統丟棄，指令看起來成功卻毫無作用。
 * 必須用實際頁碼變化來驗收。
 *
 * 呼叫前提：Keynote 正在播放，且不在最後一張。
 */
export async function probeAdvanceMethod(): Promise<AdvanceMethod> {
  const before = await snapshot()
  if (!before.open || !before.playing) return 'none'
  if (before.slide >= before.total) return 'jump' // 已在最後一張，無法探測，先給保底值

  const candidates: Array<[AdvanceMethod, () => Promise<boolean>]> = [
    ['showNext', tryShowNext],
  ]
  if (!(await screenLocked())) {
    candidates.push(['keystroke', tryKeystroke])
  }

  for (const [method, fn] of candidates) {
    const ok = await fn()
    if (!ok) continue
    await delay(500)
    const after = await snapshot()
    if (after.slide > before.slide) {
      // 真的動了，把它退回原位再回報
      await showSlide(before.slide)
      return method
    }
  }

  return 'jump'
}

/**
 * 往下一頁。依 method 採用對應手段，jump 為保底。
 *
 * @param method 由 probeAdvanceMethod() 得到的手段
 * @param current 目前投影片編號
 * @param total 總張數
 */
export async function advance(method: AdvanceMethod, current: number, total: number): Promise<void> {
  if (current >= total) return
  switch (method) {
    case 'showNext':
      if (await tryShowNext()) return
      break
    case 'keystroke':
      if (await tryKeystroke()) return
      break
  }
  await showSlide(current + 1)
}

/**
 * 回上一頁。
 *
 * 這裡一律用 show slide 直跳，不用 show previous：回上一頁時講者要的是
 * 「立刻回到那張的完整狀態」，逐格倒退動畫只會拖慢台上的節奏。
 */
export async function retreat(current: number): Promise<void> {
  if (current <= 1) return
  await showSlide(current - 1)
}

function delay(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}
