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

  // 只往前看：從目前這一行開始，往後 lookahead 個「會念出來的行」。
  // 標題、分隔線、空行不算數——否則講稿開頭有三行標題時，
  // 箭頭停在第 0 行就永遠看不到第一句台詞（2026-09-23 Meetup 講稿實際卡死）。
  const speak = speakableLines(lines)
  const candidates = speak.filter(i => i >= Math.max(0, currentLine)).slice(0, lookahead + 1)

  for (const i of candidates) {
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
 * 哪些行會被念出來。
 *
 * 講稿結構版的備忘錄長這樣：
 *   【① 轉換｜03:25　30 秒】標題…
 *   ── 台上講 ──
 *   〔原話〕真正要念的句子…
 *   ── 補充（不用念，被問到再講） ──
 *   ・…
 * 有「── 台上講 ──」就只收它到下一條「──」分隔線之間；沒有就全部都算。
 * 空行與分隔線本身一律不算。
 */
export function speakableLines(lines: string[]): number[] {
  const isDivider = (l: string) => /^\s*──.*──\s*$/.test(l)
  const stage = lines.findIndex(l => isDivider(l) && l.includes('台上講'))
  let from = 0
  let to = lines.length
  if (stage >= 0) {
    from = stage + 1
    const next = lines.findIndex((l, i) => i > stage && isDivider(l))
    if (next >= 0) to = next
  }
  const out: number[] = []
  for (let i = from; i < to; i++) {
    if (normalize(lines[i]).length > 0 && !isDivider(lines[i])) out.push(i)
  }
  return out
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
    // 講稿裡的標記不會念出來：〔原話〕〔建議〕、◆ 大字：
    .replace(/〔[^〔〕]{0,6}〕/g, '')
    .replace(/◆\s*大字[:：]?/g, '')
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
