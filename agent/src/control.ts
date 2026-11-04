/**
 * 眼鏡端送來的控制訊息驗證。
 *
 * WebSocket 上收到的任何東西都不可信：TOFU 只擋住「第二台」裝置，
 * 第一個連上的（或 SLIDECUE_LOCK_PEER=0 時的任何人）送什麼都會進到 handleControl。
 * 先前直接 `JSON.parse` 後當成 ControlMessage 用，欄位型別錯誤會：
 *   - `{"type":"audio"}`（沒有 pcm）→ Buffer.from(undefined) 在 try 外丟錯
 *   - `sampleRate: "abc"` → 存進全域取樣率，之後每一輪 WAV 表頭都寫壞，語音跟隨整場失效
 *   - `pickDeck` 的 name 不是字串 → 拼 AppleScript 時丟錯
 *   - `mode` 任意字串 → 寫進 timer.json、廣播回眼鏡
 *
 * 這裡逐型別檢查，不合格就回 null（呼叫端直接丟掉），合格則回傳只含已知欄位的新物件。
 * 刻意寫成純函式、不碰 index.ts 的全域狀態，才能單獨測試。
 */

import type { ControlMessage } from '../../glasses/src/types.ts'

/** stats 只是記進 log 的診斷字串，不需要長篇；也擋掉換行，免得偽造 log 行。 */
export const STATS_MAX_CHARS = 500
/** 一張投影片斷出來的行數上限。正常不到一百行，留足餘裕。 */
export const LINES_MAX = 2000
/** G2 實測 16 kHz；接受常見取樣率範圍，擋掉 0、負數、非整數與天文數字（會寫壞 WAV 表頭）。 */
export const SAMPLE_RATE_MIN = 8_000
export const SAMPLE_RATE_MAX = 96_000

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v)

export function parseControl(raw: unknown): ControlMessage | null {
  if (!isObj(raw)) return null
  switch (raw.type) {
    case 'control': {
      const a = raw.action
      if (a === 'next' || a === 'prev') return { type: 'control', action: a }
      if (a === 'resync') return { type: 'control', action: 'resync' }
      if (a === 'resetTimer') return { type: 'control', action: 'resetTimer' }
      return null
    }
    case 'mode':
      return raw.mode === 'ring' || raw.mode === 'manual' ? { type: 'mode', mode: raw.mode } : null
    case 'lines': {
      const { lines, slide } = raw
      if (!Array.isArray(lines) || lines.length > LINES_MAX || !lines.every(l => typeof l === 'string')) return null
      return { type: 'lines', slide: isInt(slide) ? slide : 0, lines: lines as string[] }
    }
    case 'audio': {
      if (typeof raw.pcm !== 'string') return null
      const sr = raw.sampleRate
      if (sr === undefined) return { type: 'audio', pcm: raw.pcm }
      if (!isInt(sr) || sr < SAMPLE_RATE_MIN || sr > SAMPLE_RATE_MAX) return null
      return { type: 'audio', pcm: raw.pcm, sampleRate: sr }
    }
    case 'follow':
      return typeof raw.on === 'boolean' ? { type: 'follow', on: raw.on } : null
    case 'cursorAt':
      return isInt(raw.line) && raw.line >= 0 ? { type: 'cursorAt', line: raw.line } : null
    case 'stats':
      return typeof raw.text === 'string'
        ? { type: 'stats', text: raw.text.replace(/[\r\n]+/g, ' ').slice(0, STATS_MAX_CHARS) }
        : null
    case 'pickDeck':
      if (raw.name === null) return { type: 'pickDeck', name: null }
      return typeof raw.name === 'string' ? { type: 'pickDeck', name: raw.name } : null
    default:
      return null
  }
}

/**
 * pickDeck 只接受 Keynote 目前真的開著的簡報名稱。
 *
 * 手機端是從 info.documents 清單裡選的，所以合法請求一定在清單內；
 * 不在清單裡的名稱（包括刻意構造的字串）一律不進 AppleScript。
 */
export function isKnownDeck(name: string | null, documents: ReadonlyArray<{ name: string }>): boolean {
  return name === null || documents.some(d => d.name === name)
}

/** 狀態頁把簡報名稱嵌進 HTML，要逸出——檔名可以含 `<`、`&`。 */
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}
