/**
 * 電腦位址的解析與推導。
 *
 * ## 為什麼不能把位址寫死在 app 裡
 *
 * 早期版本在建置時把「執行 build 那台 Mac」的位址編進 bundle。對開發者自己有效，
 * 但商店發布的是同一份檔案——**每個下載者的 app 都寫著開發者的電腦名稱與
 * Tailscale 位址**。那既連不上，又是資訊洩漏。所以位址一律在執行時才決定。
 *
 * ## 為什麼是三位數而不是完整 IP
 *
 * 要一位講者在上台前打 `192.168.1.50` 是不合理的。但區網 IP 的前三段
 * 幾乎總是那幾種（家用路由器、企業網段、iPhone 熱點），**真正因人而異的只有最後一段**。
 * 所以電腦上只顯示最後一段，手機端把它套進常見網段一起競速——
 * 使用者只要打三個數字。
 */

/** agent 固定監聽的埠號。 */
export const AGENT_PORT = 8788

/**
 * 常見的區網前綴，依實務命中率排序。
 *
 * `172.20.10` 特別重要：那是 iPhone 個人熱點固定使用的網段，
 * 而會場沒有 Wi-Fi 時開熱點正是最常見的情況。
 */
export const COMMON_SUBNETS = [
  '192.168.0',   // 多數家用路由器
  '192.168.1',   // 多數家用路由器
  '172.20.10',   // iPhone 個人熱點（固定）
  '10.0.0',      // 企業／部分 Apple 路由器
  '10.0.1',      // AirPort 預設
  '192.168.2',
  '192.168.50',  // 華碩
  '192.168.68',  // Google Nest / eero
] as const

/** 輸入的是不是「只有最後一段」的三位數連線碼。 */
export function isShortCode(raw: string): boolean {
  const t = raw.trim()
  if (!/^\d{1,3}$/.test(t)) return false
  const n = Number(t)
  // 0 與 255 是網路位址與廣播位址，不會是某台電腦
  return n >= 1 && n <= 254
}

/**
 * 把三位數連線碼展開成一組候選位址。
 *
 * 回傳順序即嘗試順序。全部一起競速，所以順序只影響「同時通時偏好誰」。
 */
export function expandShortCode(code: string, port = AGENT_PORT): string[] {
  const last = Number(code.trim())
  return COMMON_SUBNETS.map(net => `ws://${net}.${last}:${port}`)
}

/**
 * 把使用者填的東西補成完整的 WebSocket 位址。
 *
 * 接受各種寫法：`192.168.0.5`、`我的電腦.local`、`ws://192.168.0.5:8788`，
 * 甚至誤貼的 `http://192.168.0.5:8788/`。空字串代表「回到自動搜尋」。
 */
export function normalizeHost(raw: string): string {
  let h = raw.trim()
  if (!h) return ''

  // 使用者可能從瀏覽器網址列複製，帶著 http/https/ws/wss
  h = h.replace(/^wss?:\/\//i, '').replace(/^https?:\/\//i, '')
  // 尾端斜線與路徑一律丟掉——agent 的 WebSocket 在根路徑
  h = h.replace(/\/.*$/, '')
  if (!h) return ''

  // 沒帶埠號就補上。已經帶了就尊重使用者（可能改過 SLIDECUE_PORT）
  if (!/:\d+$/.test(h)) h += `:${AGENT_PORT}`
  return `ws://${h}`
}

/**
 * 使用者輸入 → 候選位址清單。
 *
 * 三位數展開成常見網段；其餘當成完整位址處理。
 */
export function candidatesFromInput(raw: string, port = AGENT_PORT): string[] {
  const t = raw.trim()
  if (!t) return []
  if (isShortCode(t)) return expandShortCode(t, port)
  const one = normalizeHost(t)
  return one ? [one] : []
}

/** 把完整位址還原成適合顯示給人看的樣子。 */
export function prettyHost(url: string | null): string {
  if (!url) return ''
  return url.replace(/^wss?:\/\//i, '').replace(new RegExp(`:${AGENT_PORT}$`), '')
}
