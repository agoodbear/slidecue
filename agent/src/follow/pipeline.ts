/**
 * 語音跟隨管線：PCM → 視窗 → 有聲判斷 → whisper → 過濾 → 對齊 → 箭頭。
 *
 * 從 index.ts 抽出來成一個類別，理由只有一個：**同一條管線要能離線重播**。
 * 真人錄音（recordings/*.pcm + .jsonl）用 tools/replay.ts 依原始時間餵進來，
 * 舊版／新版跑的是和現場一模一樣的程式，不是另一份模擬。
 *
 * v2（預設）與舊版的差別：
 *   - prompt：箭頭附近 160 字的局部講稿（舊版：前 800 字，大半無效）
 *   - 有聲判斷：相對底噪（舊版：固定 RMS>500，在 G2 上等於沒有）
 *   - 過濾：括號類非語音、解碼迴圈、疑似 prompt 補回
 *   - 對齊：拼音關鍵字 ＋ 局部相似度 ＋ 跨輪累積（舊版：整行 bigram dice）
 * SLIDECUE_FOLLOW_V2=0 一鍵退回舊行為（index.ts 讀這個環境變數）。
 */

import { alignToLine, JumpGate, speakableLines } from '../../../glasses/src/align.ts'
import { AudioWindow, hasSpeech, transcribe } from '../listen.ts'
import { Align2, DEFAULT_PARAMS, type Align2Params } from './align2.ts'
import { NoiseFloor, rms } from './vad.ts'
import { isNonSpeech, isPromptEcho } from './filter.ts'
import { buildLocalPrompt } from './prompt.ts'

export type FollowEventKind = 'quiet' | 'dropped' | 'empty' | 'filtered' | 'stay' | 'pending' | 'move'

export interface FollowEvent {
  kind: FollowEventKind
  cursor: number
  /** 這一輪的音訊時間（秒，從開始跟隨起算） */
  t: number
  heard?: string
  /** 對齊器認為最像的行（stay 時也給，方便校準） */
  line?: number
  score?: number
  jump?: boolean
  rms?: number
  floor?: number | null
  reason?: string
  latency?: number
}

export interface FollowOptions {
  v2: boolean
  params?: Align2Params
  /** 視野外跳躍要連兩輪指向同一行才放行（信心 ≥ 0.95 例外）。 */
  jumpConfirm?: boolean
  /**
   * 重播用：以「音訊時間 + 辨識耗時」判斷上一輪是否還沒回來（現場用 transcribing 旗標，
   * 但重播是循序 await，永遠不會忙）。
   */
  simulateBusy?: boolean
}

export class FollowPipeline {
  lines: string[] = []
  cursor = 0
  quietRounds = 0
  readonly v2: boolean
  private readonly jumpConfirm: boolean
  private readonly simulateBusy: boolean
  private readonly params: Align2Params
  private readonly aw = new AudioWindow()
  private readonly nf = new NoiseFloor()
  private readonly gate = new JumpGate()
  private a2: Align2 | null = null
  private deckLines: string[] = []
  private transcribing = false
  private audioBytes = 0
  private busyUntil = 0
  private pendingJump = -1

  constructor(opts: FollowOptions) {
    this.v2 = opts.v2
    this.jumpConfirm = opts.jumpConfirm ?? true
    this.simulateBusy = opts.simulateBusy ?? false
    this.params = opts.params ?? DEFAULT_PARAMS
  }

  /** 換張或重新斷行：箭頭回到開頭，緩衝清掉。deckLines＝整份簡報的其他行，給關鍵字權重用。 */
  setLines(lines: string[], deckLines: string[] = []): void {
    this.lines = lines
    this.deckLines = deckLines
    this.cursor = 0
    this.gate.reset()
    this.aw.reset()
    this.pendingJump = -1
    this.a2 = this.v2 ? new Align2(lines, deckLines, this.params) : null
    if (this.a2) this.cursor = this.a2.cursor
  }

  /** 講者用手勢推了箭頭：對齊要從新位置往前找。 */
  setCursor(line: number): void {
    if (line < 0 || line >= this.lines.length) return
    this.cursor = line
    this.gate.reset()
    this.pendingJump = -1
    this.a2?.setCursor(line)
  }

  /** 關掉跟隨：清緩衝與底噪估計；講稿與箭頭保留（再開時眼鏡會重送 lines）。 */
  reset(): void {
    this.aw.reset()
    this.nf.reset()
    this.quietRounds = 0
    this.transcribing = false
    this.busyUntil = 0
    this.audioBytes = 0
  }

  get deckLineCount(): number { return this.deckLines.length }

  /** 收一包 PCM。滿一個視窗才會回傳事件，否則 null。 */
  async onPcm(chunk: Buffer, sampleRate = 16_000): Promise<FollowEvent | null> {
    this.audioBytes += chunk.length
    const t = this.audioBytes / 2 / sampleRate
    if (this.v2) this.nf.push(chunk, sampleRate)
    const win = this.aw.push(chunk)
    if (!win) return null
    if (this.lines.length === 0) return null

    const r = rms(win)
    const floor = this.v2 ? this.nf.floor() : null
    const speech = this.v2 ? this.nf.isSpeech(r) : hasSpeech(win)
    if (!speech) {
      this.quietRounds++
      return { kind: 'quiet', cursor: this.cursor, t, rms: r, floor }
    }
    // 上一輪還在跑就跳過這一輪。追最新的聲音，不要排隊。
    if (this.simulateBusy ? t < this.busyUntil : this.transcribing) {
      return { kind: 'dropped', cursor: this.cursor, t, rms: r, floor }
    }
    this.transcribing = true
    try {
      return this.v2 ? await this.roundV2(win, sampleRate, t, r, floor) : await this.roundLegacy(win, sampleRate, t, r)
    } finally {
      this.transcribing = false
    }
  }

  /** 舊版：與 2026-10-15 之前的 index.ts handleAudio 逐條相同。 */
  private async roundLegacy(win: Buffer, sampleRate: number, t: number, r: number): Promise<FollowEvent> {
    const script = speakableLines(this.lines).map(i => this.lines[i]).join('')
    const t0 = Date.now()
    const heard = await transcribe(win, script, sampleRate)
    const latency = (Date.now() - t0) / 1000
    this.busyUntil = t + latency
    if (!heard) { this.quietRounds++; return { kind: 'empty', cursor: this.cursor, t, rms: r, latency } }
    this.quietRounds = 0
    const res = alignToLine(heard, this.lines, this.cursor)
    const base = { heard, line: res.line, score: res.score, cursor: this.cursor, t, rms: r, latency }
    if (res.line < 0) return { kind: 'stay', ...base }
    if (res.line === this.cursor) { this.gate.reset(); return { kind: 'stay', ...base } }
    if (!this.gate.accept(res)) return { kind: 'pending', ...base }
    this.cursor = res.line
    return { kind: 'move', ...base, cursor: this.cursor, jump: res.kind === 'jump' }
  }

  private async roundV2(win: Buffer, sampleRate: number, t: number, r: number, floor: number | null): Promise<FollowEvent> {
    const prompt = buildLocalPrompt(this.lines, this.cursor)
    const t0 = Date.now()
    const heard = await transcribe(win, prompt, sampleRate)
    const latency = (Date.now() - t0) / 1000
    this.busyUntil = t + latency
    const base = { cursor: this.cursor, t, rms: r, floor, latency }
    if (!heard) { this.quietRounds++; return { kind: 'empty', ...base } }
    if (isNonSpeech(heard)) return { kind: 'filtered', ...base, heard, reason: '非語音' }
    if (isPromptEcho(heard, prompt, r, floor)) return { kind: 'filtered', ...base, heard, reason: '疑似補回（與 prompt 逐字相同但能量貼底噪）' }
    this.quietRounds = 0
    const a2 = this.a2!
    const res = a2.feed(heard, t)
    let cursor = res.cursor
    if (res.moved && res.kind === 'jump' && this.jumpConfirm && res.conf < 0.95) {
      // 視野外跳躍：要連兩輪都指向同一行才放行
      if (this.pendingJump !== res.best) {
        this.pendingJump = res.best
        a2.cursor = this.cursor            // 對齊器的箭頭先留在原地，下一輪再看
        return { kind: 'pending', ...base, heard, line: res.best, score: res.conf, jump: true }
      }
    }
    this.pendingJump = -1
    if (cursor === this.cursor) return { kind: 'stay', ...base, heard, line: res.best, score: res.conf }
    this.cursor = cursor
    return { kind: 'move', ...base, cursor, heard, line: res.best, score: res.conf, jump: res.kind === 'jump' }
  }
}
