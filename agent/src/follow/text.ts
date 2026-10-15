/**
 * 語音跟隨 v2 的文字工具：拼音、詞項、局部相似度。
 *
 * 為什麼要拼音：whisper base 在眼鏡麥克風的音質下常把字聽成同音字
 * （「馬拉帕提」＝Mallampati、「射頭腫」＝舌頭腫），字元比對直接歸零，
 * 拼音比對（不看聲調）這些都還對得上。簡體字也因此自動等價。
 *
 * normalize／bigrams／dice／speakableLines 沿用 glasses/src/align.ts（只讀取，不改語意）。
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalize, bigrams, dice } from '../../../glasses/src/align.ts'

export { normalize, bigrams, dice }

/** 字 → 無聲調拼音。U+4E00–U+9FFF，多音字取最常見讀音（與離線評估的 pypinyin 預設一致）。 */
const TABLE: Record<string, string> = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'pinyin-table.json'), 'utf8'),
)

export function pinyinOf(ch: string): string {
  return TABLE[ch] ?? ch
}

const LATIN = /[a-z0-9][a-z0-9-]*/g
const CJK = /[一-鿿]/

/**
 * IDF 用的「詞項」：英數 token 整個算一個（L:），中文取相鄰兩字的拼音組合（B:）。
 * 不用分詞器——眼鏡斷行的講稿、whisper 的輸出都不保證是完整詞，字元 bigram 最穩。
 */
export function termsOf(normText: string): Set<string> {
  const out = new Set<string>()
  for (const m of normText.matchAll(LATIN)) out.add('L:' + m[0])
  const seq = [...normText].filter(c => CJK.test(c)).map(pinyinOf)
  for (let i = 0; i + 1 < seq.length; i++) out.add(`B:${seq[i]}|${seq[i + 1]}`)
  return out
}

/**
 * heard 的 bigram 對「行內任一段長度 width 的子串」的最大 dice。
 * 整行 dice 會被 26 字的長行稀釋（視窗只有約 11 字），局部視窗才量得出「這一段像不像」。
 */
export function localDice(hg: Set<string>, text: string, width: number): number {
  const chars = [...text]
  if (chars.length <= width) return dice(hg, bigrams(text))
  let best = 0
  for (let a = 0; a + width <= chars.length; a += 2) {
    best = Math.max(best, dice(hg, bigrams(chars.slice(a, a + width).join(''))))
  }
  return best
}

/** 取最後 n 個字（以 code point 計）。 */
export function tail(text: string, n: number): string {
  const chars = [...text]
  return chars.slice(Math.max(0, chars.length - n)).join('')
}
