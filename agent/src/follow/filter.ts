/**
 * 過濾 whisper 的非語音輸出與疑似「補回」。
 *
 * 真實 log 裡 23%（真人錄音 46%）的回合是「(笑)」「(拍攝)」「( ˘ω˘ )」「【補充】」這類東西，
 * 還有「肥肚的肥肚的肥肚的」這種解碼迴圈。它們進對齊器頂多拿 0 分，但有 prompt 時
 * whisper 會把講稿裡沒念的句子整句「補」出來，那會讓箭頭跳到沒念的地方。
 * 補回的特徵：輸出是 prompt 的逐字子串、而且那個視窗根本沒什麼聲音。
 */

import { normalize } from './text.ts'

const BRACKET = /^\s*[(（[【〔]/
const CONTENT = /[一-鿿A-Za-z0-9]/g

/** 不是語音：括號開頭、沒有兩個以上的字、或是同一小段重複三次以上。 */
export function isNonSpeech(heard: string): boolean {
  const t = heard.trim()
  if (!t || BRACKET.test(t)) return true
  const content = (t.match(CONTENT) ?? []).length
  if (content < 2) return true
  return isLoop(normalize(t))
}

/** 「肥肚的肥肚的肥肚的」：長度 2–8 的片段連續重複 ≥3 次、佔全文六成以上。 */
export function isLoop(norm: string): boolean {
  const chars = [...norm]
  for (let len = 2; len <= 8 && len * 3 <= chars.length; len++) {
    const unit = chars.slice(0, len).join('')
    let reps = 0
    for (let i = 0; i + len <= chars.length; i += len) {
      if (chars.slice(i, i + len).join('') === unit) reps++
      else break
    }
    if (reps >= 3 && reps * len >= chars.length * 0.6) return true
  }
  return false
}

/**
 * 疑似補回：輸出夠長（≥8 字）、是 prompt 的逐字子串、而且視窗能量只比底噪高一點。
 * 真的念到講稿句子時能量不會貼著底噪；貼著底噪還「聽」到整句，多半是 prompt 誘導。
 */
export function isPromptEcho(heard: string, prompt: string, windowRms: number, floor: number | null, ratio = 1.6): boolean {
  if (floor === null) return false
  const h = normalize(heard)
  if ([...h].length < 8) return false
  if (!normalize(prompt).includes(h)) return false
  return windowRms < floor * ratio
}
