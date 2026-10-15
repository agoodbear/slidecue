/**
 * 語音跟隨 v2 對齊器：關鍵字錨點 ＋ 局部相似度 ＋ 跨輪累積（score following）。
 *
 * 講者不逐字念——跳字、換說法、整句跳過，但關鍵字（術語、數字、英文）都會念到。
 * 所以每一行的證據分成兩塊：
 *   1. 關鍵字：行裡罕見的詞項（整份講稿只出現一兩次）被聽到，就是強證據；
 *      「我們」「這個」這種到處都有的詞幾乎沒分（IDF 權重）。
 *   2. 局部相似度：heard 對行內任一段的字元 bigram dice，抓「順著念」的情況。
 * 證據不是一輪定生死：維持一個「講者在哪一行」的機率分佈，每輪先依語速把機率往後推
 * （時間先驗），再乘上這一輪的證據。兩輪各 0.2 的弱證據累加起來就夠移動；一輪沒證據也不會歸零。
 *
 * 移動規則沿用原本的哲學：眼前幾行門檻低（posterior ≥ p_move），視野外（含往回）要更確定
 * （≥ p_jump），否則留在原地。
 *
 * 參數與離線評估（experiments/voice-follow-eval/vfe/aligners.py ComboTracker）相同，
 * 沒有針對真人錄音再調。唯一加上的是 minEvidence：評估時沒模擬「離題閒聊」，
 * 而沒有這道下限時，講者離題 30 秒箭頭會被時間先驗慢慢推走（TTS 跳字＋加噪：沒移 8%→11%、錯跳不變；離題句「補充一個題外話」對講稿行的證據約 1.3）。
 */

import { speakableLines } from '../../../glasses/src/align.ts'
import { normalize, bigrams, termsOf, localDice, tail } from './text.ts'

export interface Align2Params {
  betaKw: number
  betaDice: number
  pMove: number
  pJump: number
  charsPerSec: number
  stay: number
  fwd1: number
  fwd2: number
  jump: number
  tailChars: number
  driftCap: number
  lookahead: number
  /** 本輪最佳行的證據（關鍵字＋局部相似度）至少要這麼多才准移動；離題閒聊時只靠時間先驗不准動。 */
  minEvidence: number
}

export const DEFAULT_PARAMS: Align2Params = {
  betaKw: 1.0, betaDice: 4.0, pMove: 0.55, pJump: 0.8, charsPerSec: 4.0,
  stay: 0.45, fwd1: 0.35, fwd2: 0.12, jump: 0.08, tailChars: 24, driftCap: 0.6, lookahead: 3,
  minEvidence: 1.5,
}

export interface Align2Result {
  /** 這一輪之後箭頭該在哪一行（可能沒變）。 */
  cursor: number
  /** 機率最高的行與其機率，供 log 與校準。 */
  best: number
  conf: number
  moved: boolean
  /** 'near'＝視野內移動；'jump'＝視野外；'hold'＝信心不足或視野外未達跳躍門檻。 */
  kind: 'near' | 'jump' | 'hold'
}

export class Align2 {
  private readonly speak: number[]
  private readonly norm: Map<number, string>
  private readonly docs: Map<number, Set<string>>
  private readonly idf: Map<string, number>
  private belief: number[]
  private tLast: number | null = null
  readonly lines: string[]
  readonly p: Align2Params
  cursor: number

  constructor(lines: string[], deckLines: string[] = [], p: Align2Params = DEFAULT_PARAMS) {
    this.lines = lines
    this.p = p
    this.speak = speakableLines(lines)
    this.norm = new Map(this.speak.map(i => [i, normalize(lines[i])]))
    this.docs = new Map(this.speak.map(i => [i, termsOf(this.norm.get(i)!)]))
    // IDF 語料：這張的可念行 ＋ 整份簡報的其他行，「整份講稿罕見」才有意義
    const corpus: Set<string>[] = [...this.docs.values(), ...deckLines.map(l => termsOf(normalize(l)))]
    const df = new Map<string, number>()
    for (const d of corpus) for (const t of d) df.set(t, (df.get(t) ?? 0) + 1)
    const N = corpus.length
    this.idf = new Map([...df].map(([t, n]) => [t, Math.log((N + 1) / (n + 0.5))]))
    this.belief = this.speak.map((_, k) => (k === 0 ? 1 : 0))
    this.cursor = this.speak[0] ?? 0
  }

  /** 講者用手勢推了箭頭、或換張：機率全部集中到那一行。 */
  setCursor(line: number): void {
    let k = this.speak.indexOf(line)
    if (k < 0) k = Math.max(0, this.speak.findIndex(i => i >= line))
    this.belief = this.speak.map((_, j) => (j === k ? 1 : 0))
    this.cursor = this.speak[k] ?? line
    this.tLast = null
  }

  /** 時間先驗：dt 秒大約念了 charsPerSec·dt 個字，換成「期望前進幾行」把機率往後推。 */
  private transition(dt: number): void {
    const p = this.p, n = this.speak.length
    const next = new Array<number>(n).fill(0)
    for (let k = 0; k < n; k++) {
      const b = this.belief[k]
      if (b <= 0) continue
      const ln = Math.max(8, [...this.norm.get(this.speak[k])!].length)
      const adv = dt ? Math.min(p.driftCap, (p.charsPerSec * dt) / ln) : 0
      const wStay = p.stay * (1 - adv)
      const w1 = p.fwd1 + p.stay * adv
      const w2 = p.fwd2
      const wj = p.jump
      const tot = wStay + w1 + w2 + wj
      next[k] += (b * wStay) / tot
      if (k + 1 < n) next[k + 1] += (b * w1) / tot
      else next[k] += (b * w1) / tot
      if (k + 2 < n) next[k + 2] += (b * w2) / tot
      else next[Math.min(n - 1, k + 1)] += (b * w2) / tot
      for (let j = 0; j < n; j++) next[j] += (b * wj) / tot / n
    }
    const s = next.reduce((a, b) => a + b, 0) || 1
    this.belief = next.map(x => x / s)
  }

  /**
   * 餵一輪辨識結果。
   * @param heard whisper 的輸出（已過濾非語音）
   * @param t 這一輪的音訊時間（秒）；時間先驗用相鄰兩輪的差
   */
  feed(heard: string, t: number): Align2Result {
    const p = this.p
    const n = this.speak.length
    if (n === 0) return { cursor: this.cursor, best: this.cursor, conf: 0, moved: false, kind: 'hold' }
    const dt = this.tLast === null ? 0 : Math.max(0, t - this.tLast)
    this.tLast = t
    this.transition(Math.min(dt, 3))

    const h = tail(normalize(heard), p.tailChars)
    let evBest = 0
    if ([...h].length >= 2) {
      const ht = termsOf(h)
      const hg = bigrams(h)
      const width = [...h].length + 2
      const ev = this.speak.map(i => {
        let kw = 0
        const doc = this.docs.get(i)!
        for (const tm of ht) if (doc.has(tm)) kw += this.idf.get(tm) ?? 0
        return p.betaKw * kw + p.betaDice * localDice(hg, this.norm.get(i)!, width)
      })
      const mx = Math.max(...ev)
      const post = this.belief.map((b, k) => b * Math.exp(ev[k] - mx))
      const s = post.reduce((a, b) => a + b, 0) || 1
      this.belief = post.map(x => x / s)
      let k = 0
      for (let j = 1; j < n; j++) if (this.belief[j] > this.belief[k]) k = j
      evBest = ev[k]
    }

    let k = 0
    for (let j = 1; j < n; j++) if (this.belief[j] > this.belief[k]) k = j
    const best = this.speak[k], conf = this.belief[k]
    const before = this.cursor
    const view = this.speak.filter(i => i >= before).slice(0, p.lookahead + 1)
    const inView = view.includes(best)
    if (conf >= p.pMove && evBest >= p.minEvidence && (inView || conf >= p.pJump)) this.cursor = best
    const moved = this.cursor !== before
    return { cursor: this.cursor, best, conf, moved, kind: moved ? (inView ? 'near' : 'jump') : 'hold' }
  }
}
