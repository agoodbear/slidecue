/**
 * AppleScript 字串字面值。
 *
 * ⚠️ 任何要拼進 osascript 原始碼的外部字串（簡報名稱來自手機端的 pickDeck）
 * 一律經過這裡，不要自己 replace。
 *
 * 舊寫法只把 `"` 換成 `\"`，沒處理反斜線：輸入 `\"` 會變成 `\\"`——
 * 前兩個字元在 AppleScript 是「一個反斜線」，接著的 `"` 就把字串關掉了，
 * 後面的內容直接當成程式碼執行（例如 `do shell script`）。
 * 必須先逸出反斜線、再逸出雙引號，順序不能反。
 */
export function asString(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}
