/**
 * 有沒有人在講話：相對底噪，不是固定門檻。
 *
 * 固定 RMS>500 在 G2 上等於沒有閘門——眼鏡麥克風的底噪本身就約 950–1000
 * （2026-10-15 兩段真人錄音實測），所有視窗都放行，whisper 對著噪音吐出
 * 「(拍攝)」「(笑)」。改成：追蹤最近 30 秒裡最安靜那一成的 50 ms 片段
 * （講話之間的停頓一定有），當作底噪；視窗 RMS 超過底噪的 1.3 倍才算有聲。
 *
 * 靜音檔（TTS、安靜房間）底噪趨近 0，所以另設絕對下限，免得風扇聲就觸發。
 */

const CHUNK_MS = 50
const HISTORY_SEC = 30
const MAX_CHUNKS = (HISTORY_SEC * 1000) / CHUNK_MS

export const LEGACY_RMS_THRESHOLD = 500
export const DEFAULT_RATIO = 1.3
export const MIN_ABS = 300
/** 底噪估計至少要有這麼多片段（2 秒）才可信，之前沿用固定門檻。 */
const WARMUP_CHUNKS = 40

export function rms(pcm: Buffer): number {
  const n = Math.floor(pcm.length / 2)
  if (n === 0) return 0
  let sum = 0
  for (let i = 0; i < n; i++) {
    const v = pcm.readInt16LE(i * 2)
    sum += v * v
  }
  return Math.sqrt(sum / n)
}

export class NoiseFloor {
  private ring: number[] = []
  private head = 0

  /** 每收到一包 PCM 就餵進來（live 每包 50 ms；大包會自動切）。 */
  push(chunk: Buffer, sampleRate = 16_000): void {
    const bytesPerChunk = Math.max(2, Math.floor((sampleRate * CHUNK_MS) / 1000) * 2)
    for (let off = 0; off < chunk.length; off += bytesPerChunk) {
      const v = rms(chunk.subarray(off, Math.min(chunk.length, off + bytesPerChunk)))
      if (this.ring.length < MAX_CHUNKS) this.ring.push(v)
      else { this.ring[this.head] = v; this.head = (this.head + 1) % MAX_CHUNKS }
    }
  }

  /** 目前的底噪估計：最近 30 秒片段 RMS 的第 10 百分位；資料不夠回傳 null。 */
  floor(): number | null {
    if (this.ring.length < WARMUP_CHUNKS) return null
    const sorted = [...this.ring].sort((a, b) => a - b)
    return sorted[Math.floor(sorted.length * 0.1)]
  }

  /** 這個視窗的 RMS 算不算有人講話。 */
  isSpeech(windowRms: number, ratio = DEFAULT_RATIO): boolean {
    const f = this.floor()
    if (f === null) return windowRms > LEGACY_RMS_THRESHOLD
    return windowRms > Math.max(MIN_ABS, f * ratio)
  }

  reset(): void { this.ring = []; this.head = 0 }
}
