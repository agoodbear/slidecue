/**
 * 給 whisper 的 prompt：箭頭附近的局部講稿。
 *
 * 原本把整張可念行的前 800 字丟進去，但 whisper.cpp 只保留 prompt **尾端**約 223 個 token
 * （中文約 160 字）；實測目標句放在 800 字的開頭或中段，輸出和沒有 prompt 一模一樣。
 * 所以 prompt 只放箭頭前一行到後兩行、總長不超過 160 字，整段都在有效範圍內。
 * 整句講稿還是要給——眼鏡麥克風的音質下，沒有講稿 whisper base 幾乎解不出字
 * （2026-10-15 真人錄音：無 prompt 時只對到 1/6 區間，有 prompt 5–6/6）。
 *
 * 排版記號（**、〔原話〕、◆ 大字：）拿掉，否則 whisper 會輸出「**」。
 */

import { speakableLines } from '../../../glasses/src/align.ts'

export const PROMPT_MAX_CHARS = 160

const MARKS = [/\*\*/g, /〔[^〔〕]{0,6}〕/g, /◆\s*大字[:：]?/g, /^[•・·]\s*/]

export function cleanLine(line: string): string {
  let s = line
  for (const rx of MARKS) s = s.replace(rx, '')
  return s.trim()
}

/**
 * @param lines 眼鏡端斷好的行
 * @param cursor 箭頭目前在哪一行
 * @param before 往前帶幾行（預設 1）、after 往後帶幾行（預設 2）
 */
export function buildLocalPrompt(lines: string[], cursor: number, maxChars = PROMPT_MAX_CHARS, before = 1, after = 2): string {
  const speak = speakableLines(lines)
  if (speak.length === 0) return ''
  let k = speak.indexOf(cursor)
  if (k < 0) { k = speak.findIndex(i => i >= cursor); if (k < 0) k = speak.length - 1 }
  const pick = speak.slice(Math.max(0, k - before), k + after + 1)
  const parts = pick.map(i => cleanLine(lines[i])).filter(Boolean)
  let text = parts.join('')
  // 超長：先丟前文，再從尾端截
  if ([...text].length > maxChars && pick.length > 1 && pick[0] !== speak[k]) text = parts.slice(1).join('')
  const chars = [...text]
  return chars.slice(0, maxChars).join('')
}
