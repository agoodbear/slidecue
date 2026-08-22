/**
 * 重繪合併。
 *
 * ## 解決什麼問題
 *
 * 每次更新眼鏡上的一個容器，都是一趟藍牙來回，實測約 115 ms。
 * 而使用者在鏡腿上連續滑動時，手勢比這更快。若每個手勢都送一次指令，
 * 它們會排成一列慢慢播，畫面一直在追早就過期的位置——實機上看起來
 * 就是整段講稿跟著箭頭上下抖。
 *
 * ## 為什麼不用固定間隔的節流
 *
 * 節流要猜一個間隔：猜太短擋不住排隊，猜太長讓單次滑動變鈍，而藍牙延遲
 * 本來就會隨環境變動，沒有一個間隔永遠是對的。
 *
 * 這裡改用「同時只允許一次在飛」：快就多畫幾次，慢就自動合併，
 * 而且單次操作依然立刻反應。等待中的請求不排隊，只記下「畫完還要再畫一次」，
 * 補畫時用的是**當下最新的狀態**，不是當初排隊時的舊值。
 */

const inFlight = new Set<string>()
const pending = new Set<string>()

/**
 * 執行一次繪製；同一個 key 正在繪製時，只記錄稍後要補畫。
 *
 * @param key 繪製目標的識別；不同 key 互不影響
 * @param draw 實際的繪製動作，每次補畫都會重新呼叫以取得最新狀態
 */
export async function coalesce(key: string, draw: () => Promise<void>): Promise<void> {
  if (inFlight.has(key)) {
    pending.add(key)
    return
  }
  inFlight.add(key)
  try {
    await draw()
  } finally {
    inFlight.delete(key)
    if (pending.delete(key)) await coalesce(key, draw)
  }
}

/** 測試用：清掉所有狀態。 */
export function resetCoalesce(): void {
  inFlight.clear()
  pending.clear()
}
