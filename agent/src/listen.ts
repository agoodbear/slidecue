/**
 * 語音跟隨：把眼鏡麥克風收到的聲音變成「講者念到第幾行」。
 *
 * ## 為什麼收音在眼鏡、辨識在 Mac
 *
 * 收音必須在眼鏡：講者會走動，筆電留在講台上，大場地用筆電收音必然失敗。
 * 辨識必須在 Mac：whisper 的模型有 1.5 GB，手機 WebView 跑不動，
 * 而 Mac 反正已經為了讀 Keynote 在跑了。
 *
 * ## 為什麼把講稿餵給 whisper 當 prompt
 *
 * 這一步不是可有可無的優化，是**整條管線能不能用的分水嶺**。實測同一段音訊：
 *
 *   不給 prompt → 「第二,第一章正常不代表没事,20分钟后再做一章。」
 *   給了 prompt → 「第二，第一張正常不代表沒事，二十分鐘後再做一張。」
 *
 * 簡體、同音錯字（章／張）、數字寫法（20／二十）全部自己修正了。
 * 對齊用的是雙字元組重疊率，簡體會讓比對分數掉到 0.35 邊緣；
 * 給了 prompt 之後是 0.88，中間隔著整個安全邊際。
 */

import { alignToLine, speakableLines, type AlignResult } from '../../glasses/src/align.ts'

/** whisper-server 的位址。啟動時由 index.ts 探測後填入。 */
let endpoint: string | null = null

export function setWhisperEndpoint(url: string | null): void {
  endpoint = url
}

export function whisperEndpoint(): string | null {
  return endpoint
}

/**
 * 送多久的音訊去辨識一次。
 *
 * 太短：whisper 缺乏上下文，辨識率掉得很快。
 * 太長：箭頭跟不上講者，體感就是「慢半拍」。
 * 2.5 秒是折衷——一句話通常念得完，而 whisper 實測 0.5 秒就回來了。
 */
const WINDOW_SEC = 2.5

/**
 * 每次往前推進多久。小於視窗長度即形成重疊，
 * 避免詞被切在邊界上兩邊都聽不完整。
 */
const STEP_SEC = 1.2

/** G2 送上來的 PCM 格式。實測後若不符，index.ts 會記錄下來。 */
const SAMPLE_RATE = 16_000
const BYTES_PER_SAMPLE = 2

const WINDOW_BYTES = Math.floor(WINDOW_SEC * SAMPLE_RATE * BYTES_PER_SAMPLE)
const STEP_BYTES = Math.floor(STEP_SEC * SAMPLE_RATE * BYTES_PER_SAMPLE)

/**
 * 滑動視窗緩衝。
 *
 * 收到的 PCM 一段一段累積，滿一個視窗就送去辨識，然後往前滑動一步，
 * 保留重疊的部分。舊資料要丟掉，否則長篇演講會把記憶體吃光。
 */
export class AudioWindow {
  private buf = Buffer.alloc(0)

  /** 加入一段 PCM。回傳滿了要送去辨識的視窗，還沒滿則回傳 null。 */
  push(chunk: Buffer): Buffer | null {
    this.buf = Buffer.concat([this.buf, chunk])
    if (this.buf.length < WINDOW_BYTES) return null

    const window = this.buf.subarray(this.buf.length - WINDOW_BYTES)
    // 滑動：保留重疊區，其餘丟棄
    this.buf = this.buf.subarray(Math.max(0, this.buf.length - WINDOW_BYTES + STEP_BYTES))
    return Buffer.from(window)
  }

  reset(): void {
    this.buf = Buffer.alloc(0)
  }

  get pending(): number {
    return this.buf.length
  }
}

/**
 * 把裸 PCM 包成 WAV。
 *
 * whisper-server 要的是完整的 WAV 檔而不是裸樣本，所以得自己補 44 位元組的表頭。
 * 用 ffmpeg 轉也行，但那要多起一個程序、多一次磁碟來回，在 1.2 秒一輪的節奏下不划算。
 */
export function pcmToWav(pcm: Buffer, sampleRate = SAMPLE_RATE): Buffer {
  const header = Buffer.alloc(44)
  const byteRate = sampleRate * BYTES_PER_SAMPLE
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + pcm.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)        // fmt chunk 長度
  header.writeUInt16LE(1, 20)         // PCM
  header.writeUInt16LE(1, 22)         // 單聲道
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(byteRate, 28)
  header.writeUInt16LE(BYTES_PER_SAMPLE, 32) // block align
  header.writeUInt16LE(8 * BYTES_PER_SAMPLE, 34) // 位元深度
  header.write('data', 36)
  header.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([header, pcm])
}

/**
 * 這段音訊有沒有人在講話。
 *
 * 靜音也送去辨識的話，whisper 會「腦補」出講稿裡的句子（因為講稿就在 prompt 裡），
 * 箭頭於是在沒人說話時自己往前跑。這個閘門擋掉那件事。
 */
export function hasSpeech(pcm: Buffer, threshold = 500): boolean {
  if (pcm.length < 2) return false
  let sum = 0
  const n = Math.floor(pcm.length / 2)
  for (let i = 0; i < n; i++) {
    const v = pcm.readInt16LE(i * 2)
    sum += v * v
  }
  return Math.sqrt(sum / n) > threshold
}

/**
 * 送一段音訊去辨識。
 *
 * @param script 整張投影片的講稿，當作 prompt 交給 whisper——見檔頭說明
 */
export async function transcribe(pcm: Buffer, script: string, sampleRate = SAMPLE_RATE): Promise<string> {
  if (!endpoint) return ''

  const form = new FormData()
  // Buffer 的底層可能是 SharedArrayBuffer，Blob 的型別不收；複製成乾淨的 Uint8Array
  const wav = pcmToWav(pcm, sampleRate)
  const bytes = new Uint8Array(wav.byteLength)
  bytes.set(wav)
  form.append('file', new Blob([bytes], { type: 'audio/wav' }), 'a.wav')
  form.append('response_format', 'json')
  form.append('temperature', '0')
  if (script) form.append('prompt', script.slice(0, 800))

  // 一定要有逾時：whisper-server 卡住時沒有上限的話，呼叫端的「辨識中」旗標
  // 永遠不會放開，箭頭整場不動，只能關掉跟隨重開。正常一輪約 0.6 秒。
  const res = await fetch(`${endpoint}/inference`, { method: 'POST', body: form, signal: AbortSignal.timeout(10_000) })
  if (!res.ok) return ''
  const data = (await res.json()) as { text?: string }
  return (data.text ?? '').trim()
}

/**
 * 一輪完整的「聽 → 對齊」。
 *
 * @param lines 眼鏡端斷好的行——箭頭以行為單位移動，所以對齊也必須以行為單位
 * @param currentLine 箭頭現在在哪
 * @returns 對齊結果與聽到的內容；line 為 -1 表示信心不足，呼叫端應維持原位
 */
export async function listenOnce(
  pcm: Buffer,
  lines: string[],
  currentLine: number,
  sampleRate = SAMPLE_RATE,
): Promise<(AlignResult & { heard: string }) | null> {
  if (!hasSpeech(pcm)) return null
  if (lines.length === 0) return null

  // prompt 只放會念出來的行。補充段放進去的話，whisper 會從那裡腦補句子，
  // 而那些句子不在對齊範圍內，只會一直「對不上」。
  const heard = await transcribe(pcm, speakableLines(lines).map(i => lines[i]).join(''), sampleRate)
  if (!heard) return null

  const r = alignToLine(heard, lines, currentLine)
  return { ...r, heard }
}
