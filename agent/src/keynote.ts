/**
 * Keynote 橋接層。
 *
 * ## 這台機器上有兩個 Keynote
 *
 * Apple 在 2026-01 推出 Creator Studio，並於 2026-04-13 把舊版
 * Pages／Keynote／Numbers 從 Mac App Store 下架。於是同一台 Mac 上
 * 可能同時存在兩個 Keynote，而且**新版的 bundle id 比較短**：
 *
 *   com.apple.Keynote         Keynote Creator Studio 15.x  ← 現行版，還在更新
 *   com.apple.iWork.Keynote   Keynote 14.x                 ← 已下架的舊版
 *
 * 兩者的 AppleScript 字典相同，所以同一段指令對誰講都行——問題只在
 * **對誰講**。使用者從 Dock 或 Spotlight 開檔案時，開到的是新版；
 * 若程式只問舊版，就會得到「沒有開著任何簡報」，而畫面上明明開著。
 *
 * 因此這裡不寫死任何一個，而是探測「哪一個真的開著文件」，並記住它。
 * 兩個都開著時優先新版——那是 Apple 現在唯一還在更新的版本。
 *
 * ⚠️ 絕對不要用 `tell application "Keynote"`（用名字定址）。兩個 app 的
 * CFBundleName 都是 "Keynote"，解析結果無法預期。一律用 bundle id。
 */

import { execFile, execFileSync } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

/** 現行版（Creator Studio，2026-01 起）。優先順序高。 */
const KEYNOTE_NEW = 'com.apple.Keynote'
/** 舊版（2026-04 已從 App Store 下架，不再更新）。 */
const KEYNOTE_OLD = 'com.apple.iWork.Keynote'

/**
 * 目前正在對話的那一個。
 *
 * 記住它是為了省下每次輪詢都探測兩邊的成本——每次 AppleScript 來回
 * 都要起一個 osascript 程序，在 250ms 的輪詢節奏下不能浪費。
 */
let activeApp: string = KEYNOTE_NEW

/** 分隔多筆資料用的控制字元，正常講稿不會出現。 */
const RS = '\x1e' // record separator：分隔每一張投影片
const US = '\x1f' // unit separator：分隔同一筆內的欄位

/**
 * 這個 app 現在有沒有在執行。
 *
 * 用行程清單判斷，不送 AppleEvent——送 AppleEvent 會把沒在跑的 app 啟動起來，
 * 而「查一下它在不在」不該有啟動別人的副作用。pgrep 也不需要任何授權。
 */
function isRunning(bundleId: string): boolean {
  // 兩個 Keynote 的執行檔都叫 Keynote，只有 .app 路徑不同，所以比對路徑
  const needle = bundleId === KEYNOTE_NEW
    ? 'Keynote Creator Studio.app'
    : '/Applications/Keynote.app'
  try {
    execFileSync('/usr/bin/pgrep', ['-f', needle], { stdio: 'pipe' })
    return true
  } catch {
    return false   // pgrep 找不到就是非零退出
  }
}

/** 目前跟哪一個 Keynote 對話，給診斷用。 */
export function activeKeynoteId(): string {
  return activeApp
}

export interface KeynoteSnapshot {
  /** Keynote 是否開著任何簡報 */
  open: boolean
  /** 是否正在播放 */
  playing: boolean
  /** 目前投影片，1-based；沒有文件時為 0 */
  slide: number
  /** 總張數 */
  total: number
  /** 簡報檔名，用來偵測是否換了檔案 */
  name: string
  /** Keynote 一共開著幾個文件。>1 時要提醒使用者，見下方說明。 */
  docCount: number
}

/**
 * 執行一段 AppleScript，回傳 stdout（去掉尾端換行）。
 *
 * 加上逾時：常駐執行時，若 macOS 正在等使用者回應自動化授權對話框，
 * AppleScript 會一直卡著。沒有上限的話整個輪詢迴圈會凍住。
 */
async function osa(script: string, timeoutMs = 8000): Promise<string> {
  const { stdout } = await run('osascript', ['-e', script], {
    maxBuffer: 32 * 1024 * 1024,
    encoding: 'utf8',
    timeout: timeoutMs,
  })
  return stdout.replace(/\n$/, '')
}

/**
 * 讀取目前狀態。這支會被高頻輪詢（約每 300ms），
 * 所以刻意只回傳輕量欄位，不含講稿內容。
 */
export async function snapshot(pinned: string | null = null): Promise<KeynoteSnapshot> {
  // 使用者在手機上點名指定了某一份，就跟那一份；那份被關掉時自動退回最前面的。
  const pick = pinned
    ? `
      set d to front document
      repeat with x in documents
        if (name of x) is "${pinned.replace(/"/g, '\\"')}" then
          set d to x
          exit repeat
        end if
      end repeat`
    : `
      set d to front document`

  // ⚠️ 先確認 Keynote 在跑，才對它 tell。
  // 這支是輪詢每一輪的第一步，Keynote 關掉時仍每 10 秒被呼叫一次；直接 tell 會把它重新叫起來，
  // 2026-09-14 實測：使用者結束 Keynote 後 3–13 秒內被叫回，停在「打開」視窗。
  // `application id … is running` 不送 AppleEvent、不會啟動 app（同日實測兩個分支），
  // 而且跟查詢在同一次 osascript 裡，不像 pgrep 在高頻輪詢時每次多開一個行程。
  const raw = await osa(`
    if not (application id "${activeApp}" is running) then return "0${US}false${US}0${US}0${US}${US}0"
    tell application id "${activeApp}"
      set c to count of documents
      if c is 0 then return "0${US}false${US}0${US}0${US}${US}0"
      ${pick}
      set p to playing as text
      set n to slide number of current slide of d
      set t to count of slides of d
      return "1${US}" & p & "${US}" & n & "${US}" & t & "${US}" & (name of d) & "${US}" & c
    end tell
  `)
  const [open, playing, slide, total, name, docCount] = raw.split(US)
  return {
    open: open === '1',
    playing: playing === 'true',
    slide: Number(slide) || 0,
    total: Number(total) || 0,
    name: name ?? '',
    docCount: Number(docCount) || 0,
  }
}

/**
 * 一次取出所有投影片的講者附註。
 *
 * 刻意整份抓取，而不是翻頁當下才去問 Keynote：每次 AppleScript 來回約
 * 60–100ms，台上多這個延遲很明顯。整份先抓好放記憶體，翻頁時純查表。
 */
export async function allNotes(pinned: string | null = null): Promise<string[]> {
  const pick = pinned
    ? `
      set d to front document
      repeat with x in documents
        if (name of x) is "${pinned.replace(/"/g, '\\"')}" then
          set d to x
          exit repeat
        end if
      end repeat`
    : `
      set d to front document`

  const raw = await osa(`
    tell application id "${activeApp}"
      if (count of documents) is 0 then return ""
      ${pick}
      set out to ""
      repeat with i from 1 to count of slides of d
        set nt to presenter notes of slide i of d
        if nt is missing value then set nt to ""
        set out to out & (nt as text) & "${RS}"
      end repeat
      return out
    end tell
  `)
  if (!raw) return []
  const parts = raw.split(RS)
  parts.pop() // 尾端分隔符後面的空字串
  return parts
}

/**
 * 主動跳到指定投影片（1-based）。
 *
 * 已實測：播放中呼叫這支，Keynote 的 current slide 會確實更新，附註也同步正確。
 * 這是「由 R1 戒指主導翻頁」那條路徑的基礎。
 */
export async function showSlide(n: number, pinned: string | null = null): Promise<void> {
  // 指定了某一份就對那一份下令，不然眼鏡看的是 A、翻的卻是最前面的 B
  const pick = pinned
    ? `
      set d to front document
      repeat with x in documents
        if (name of x) is "${pinned.replace(/"/g, '\\"')}" then
          set d to x
          exit repeat
        end if
      end repeat`
    : `
      set d to front document`
  await osa(`
    tell application id "${activeApp}"
      if (count of documents) is 0 then return
      ${pick}
      show slide ${Math.max(1, Math.floor(n))} of d
    end tell
  `)
}

/**
 * 直接執行這支檔案時，對目前開著的 Keynote 做一次自我檢查。
 *
 * 包成 async IIFE 而不是頂層 await：打包成單一執行檔時走 CommonJS，
 * 而 CommonJS 不支援頂層 await。用 argv 判斷而非 import.meta，理由相同。
 */
if (process.argv[1]?.endsWith('keynote.ts')) {
  void (async () => {
    const s = await snapshot()
    console.log('snapshot:', s)
    if (s.open) {
      const notes = await allNotes()
      console.log(`allNotes: 取得 ${notes.length} 張`)
      notes.forEach((n, i) => {
        const preview = n.replace(/\n/g, '⏎').slice(0, 40)
        console.log(`  ${i + 1}. ${preview || '(空白)'}`)
      })
    }
  })()
}

/**
 * 列出 Keynote 目前開著的所有簡報。
 *
 * 手機端用它來讓使用者點名指定要跟哪一份。開多份是真實情況——
 * 主簡報、備用簡報、參考資料常常同時開著，而「最前面那一份」
 * 不一定是等一下要講的那一份。
 *
 * 只在文件數變動時才呼叫，不進高頻輪詢：每多一份文件就多一次 AppleScript 來回。
 */
export async function listDocuments(): Promise<Array<{ name: string; slides: number }>> {
  const raw = await osa(`
    tell application id "${activeApp}"
      set c to count of documents
      if c is 0 then return ""
      set out to ""
      repeat with i from 1 to c
        set out to out & (name of document i) & "${US}" & (count of slides of document i) & "${RS}"
      end repeat
      return out
    end tell
  `)
  if (!raw) return []
  return raw
    .split(RS)
    .filter(Boolean)
    .map(row => {
      const [name, slides] = row.split(US)
      return { name: name ?? '', slides: Number(slides) || 0 }
    })
}

/**
 * 決定要跟哪一個 Keynote 對話。
 *
 * 規則很簡單：**誰開著文件就跟誰**。兩個都開著時選新版，
 * 因為那是 Apple 現在唯一還在更新的版本。兩個都沒開就維持原狀，
 * 等下一次輪詢再說。
 *
 * 這支只在「目前這個沒開著文件」時才會被呼叫，不進高頻路徑。
 */
export async function pickKeynote(): Promise<{ app: string; count: number }> {
  const ask = async (bundleId: string): Promise<number> => {
    // ⚠️ 先確認它真的在跑，才問它問題。
    //
    // `tell application id "..."` 送給一個**沒在執行**的 app 會把它啟動起來。
    // 原本這裡直接對兩個 bundle id 都送查詢，於是每次「目前這個沒開文件」時，
    // 就會默默把另一版 Keynote 叫醒——使用者只是開了新版，桌面上卻莫名
    // 冒出舊版的視窗。擴充到 PowerPoint 之後這個問題只會更明顯
    // （冷啟動更慢，還會撞上第一次的自動化授權對話框）。
    //
    // 用 pgrep 而不是 System Events：查行程不需要任何授權，
    // 而這支要在「什麼都還沒授權」的狀態下也能跑。
    if (!isRunning(bundleId)) return 0
    try {
      const raw = await osa(
        `tell application id "${bundleId}" to return (count of documents) as text`,
        4000,
      )
      return Number(raw) || 0
    } catch {
      // 在跑但問不到——多半是還沒拿到自動化授權
      return 0
    }
  }

  const [nNew, nOld] = await Promise.all([ask(KEYNOTE_NEW), ask(KEYNOTE_OLD)])
  if (nNew > 0) {
    activeApp = KEYNOTE_NEW
    return { app: KEYNOTE_NEW, count: nNew }
  }
  if (nOld > 0) {
    activeApp = KEYNOTE_OLD
    return { app: KEYNOTE_OLD, count: nOld }
  }
  return { app: activeApp, count: 0 }
}

/** 兩個 Keynote 分別裝了沒、各自開著幾份，給診斷用。 */
export async function keynoteVariants(): Promise<Array<{ id: string; label: string; docs: number }>> {
  const ask = async (bundleId: string): Promise<number> => {
    if (!isRunning(bundleId)) return 0   // 沒在跑就別把它叫醒
    try {
      return Number(await osa(`tell application id "${bundleId}" to return (count of documents) as text`, 4000)) || 0
    } catch {
      return -1   // 在跑但問不到（多半沒授權），與「開著 0 份」不同
    }
  }
  return [
    { id: KEYNOTE_NEW, label: 'Keynote（Creator Studio，現行版）', docs: await ask(KEYNOTE_NEW) },
    { id: KEYNOTE_OLD, label: 'Keynote 14（舊版，已下架）', docs: await ask(KEYNOTE_OLD) },
  ]
}
