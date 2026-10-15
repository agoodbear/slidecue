/**
 * 語音跟隨的收音錄存（驗證用，預設關閉）。
 *
 * 離線評估只有 TTS 合成音，真人念法、G2 麥克風、BLE 傳輸的音質都沒測過。
 * 這裡把眼鏡送上來的原始 PCM 與當下的講稿行、箭頭位置一起存下來，
 * 之後可以拿同一段真人錄音重跑各種對齊器比較。
 *
 * 開關是一個旗標檔，不必改 launchd、不必重啟 agent：
 *   touch "~/Library/Application Support/SlideCue/record.on"   開
 *   rm    "~/Library/Application Support/SlideCue/record.on"   關
 *
 * 錄音含講稿與臨床內容，只存在本機，不上傳。
 */

import { existsSync, mkdirSync, appendFileSync } from 'node:fs'

const BASE = `${process.env.HOME}/Library/Application Support/SlideCue`
const FLAG = `${BASE}/record.on`
const DIR = `${BASE}/recordings`

let session: string | null = null
let pcmBytes = 0
let checkedAt = 0
let enabled = false

/** 每秒最多查一次旗標檔，音訊每 100 ms 一包，不要每包都碰檔案系統。 */
function isOn(): boolean {
  const now = Date.now()
  if (now - checkedAt > 1000) {
    checkedAt = now
    const was = enabled
    enabled = existsSync(FLAG)
    if (was && !enabled) session = null
  }
  return enabled
}

function ensureSession(): string {
  if (!session) {
    mkdirSync(DIR, { recursive: true })
    const d = new Date()
    const p = (n: number) => String(n).padStart(2, '0')
    session = `${DIR}/${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
    pcmBytes = 0
  }
  return session
}

/** 記一筆事件（換張的講稿行、箭頭移動、取樣率）。t 是相對於音訊開頭的位元組位置，換算時間用。 */
export function recordEvent(ev: Record<string, unknown>): void {
  if (!isOn()) return
  const s = ensureSession()
  appendFileSync(`${s}.jsonl`, JSON.stringify({ at: Date.now(), pcmBytes, ...ev }) + '\n')
}

/** 存一包原始 PCM（16-bit LE 單聲道）。回傳 true 代表這包開啟了新的錄音段，呼叫端要補記當下的講稿行。 */
export function recordAudio(chunk: Buffer, sampleRate: number): boolean {
  if (!isOn()) return false
  const s = ensureSession()
  const fresh = pcmBytes === 0
  if (fresh) appendFileSync(`${s}.jsonl`, JSON.stringify({ at: Date.now(), pcmBytes: 0, type: 'start', sampleRate }) + '\n')
  appendFileSync(`${s}.pcm`, chunk)
  pcmBytes += chunk.length
  return fresh
}
