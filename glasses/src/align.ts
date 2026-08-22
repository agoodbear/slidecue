/**
 * 語音對齊：判斷講者念到講稿的哪一行。
 *
 * 這不是語音辨識問題，是**對齊**問題——講稿全文我們已經知道了，
 * 只需要在辨識結果和已知文字之間找對應位置。這比開放辨識容易得多，
 * 也因此可以容忍相當程度的辨識錯誤。
 *
 * 三個設計原則，都是為了「台上不能出錯」：
 *
 *  1. **只往前，不回頭。** 講者念稿是單調前進的。允許往回匹配的話，
 *     講稿裡重複出現的詞（「心電圖」「這位病人」）會讓箭頭來回亂跳。
 *
 *  2. **模糊比對，不精確比對。** 用雙字元組重疊率——whisper 把
 *     「寬 QRS 頻脈」聽成「寬 QS 頻脈」不該影響定位，講者自己
 *     即興改幾個字也不該影響。
 *
 *  3. **寧可不動，不可跳錯。** 信心不足就維持原位。箭頭停在原地
 *     講者還讀得下去，跳到錯的地方會當場斷片。
 */

/** 往後看幾行。太小會跟不上快速念稿，太大會提高跳錯機率。 */
export const DEFAULT_LOOKAHEAD = 3

/** 相似度低於這個值就不動。實測校準前先取保守值。 */
export const DEFAULT_THRESHOLD = 0.3

/** 只拿辨識結果的最後這麼多字來比對——講者「現在」念到哪才是重點。 */
export const DEFAULT_TAIL_CHARS = 16

export interface AlignResult {
  /** 對到第幾行（全域索引）。-1 表示信心不足，呼叫端應維持原位。 */
  line: number
  /** 勝出的相似度，供除錯與門檻校準用。 */
  score: number
}

export interface AlignOptions {
  lookahead?: number
  threshold?: number
  tailChars?: number
}

/**
 * 把辨識結果對到某一行。
 *
 * @param heard whisper 最近聽到的文字（可以含錯字）
 * @param lines 講稿斷好的行
 * @param currentLine 箭頭目前在第幾行
 */
export function alignToLine(
  heard: string,
  lines: string[],
  currentLine: number,
  opts: AlignOptions = {},
): AlignResult {
  const lookahead = opts.lookahead ?? DEFAULT_LOOKAHEAD
  const threshold = opts.threshold ?? DEFAULT_THRESHOLD
  const tailChars = opts.tailChars ?? DEFAULT_TAIL_CHARS

  const tail = normalize(heard).slice(-tailChars)
  if (tail.length < 2) return { line: -1, score: 0 }

  const heardGrams = bigrams(tail)
  if (heardGrams.size === 0) return { line: -1, score: 0 }

  let bestLine = -1
  let bestScore = 0

  // 只往前看：從目前這一行開始，往後 lookahead 行
  const from = Math.max(0, currentLine)
  const to = Math.min(lines.length - 1, currentLine + lookahead)

  for (let i = from; i <= to; i++) {
    const score = dice(heardGrams, bigrams(normalize(lines[i])))
    // 嚴格大於：分數相同時保留較前面的行，避免無謂的前跳
    if (score > bestScore) {
      bestScore = score
      bestLine = i
    }
  }

  if (bestScore < threshold) return { line: -1, score: bestScore }
  return { line: bestLine, score: bestScore }
}

/**
 * 正規化：拿掉不影響語音的東西。
 *
 * 標點在語音裡本來就不存在，空白在中文裡也不穩定，
 * 英文大小寫更是辨識引擎各家不一。
 */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\s　]+/g, '')
    .replace(/[，。、；：！？「」『』（）()[\]{}<>《》〈〉—…·.,;:!?"'`~@#$%^&*_+=|\\/-]/g, '')
}

/** 取字元雙連組。中文用這個粒度剛好，英文則接近音節。 */
export function bigrams(text: string): Set<string> {
  const chars = [...text]
  const out = new Set<string>()
  for (let i = 0; i + 1 < chars.length; i++) {
    out.add(chars[i] + chars[i + 1])
  }
  return out
}

/** Dice 係數：兩個集合的重疊程度，範圍 0~1。 */
export function dice(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let hit = 0
  for (const g of a) if (b.has(g)) hit++
  return (2 * hit) / (a.size + b.size)
}
