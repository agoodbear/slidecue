/**
 * 手勢 → 動作的對照。
 *
 * 從 main.ts 抽出來是為了能測：main.ts 有頂層 await（等 Even bridge），
 * 整檔無法在測試裡 import，而手勢路由正是最常改、也最容易改壞的地方。
 * 這裡只做判斷、不碰 bridge 或連線，main.ts 依回傳的動作去執行。
 */

import type { EvenHubEvent } from '@evenrealities/even_hub_sdk'
import type { ControlMode } from './types.ts'

/** OsEventTypeList 的手勢碼。 */
export const CLICK = 0
export const SWIPE_UP = 1        // SCROLL_TOP_EVENT
export const SWIPE_DOWN = 2      // SCROLL_BOTTOM_EVENT
export const DOUBLE_CLICK = 3
/** LONG_PRESS_EVENT（SDK 0.0.14 起）。放開（10）不處理，只在按下那一刻動作一次。 */
export const LONG_PRESS = 9

export type GestureAction =
  | 'exit'        // 離開 app
  | 'sendNext'    // 叫 Keynote 前進一步
  | 'sendPrev'    // 叫 Keynote 回上一張
  | 'localNext'   // 離線：推進快取的下一張
  | 'localPrev'   // 離線：退回快取的上一張
  | 'cursorUp'
  | 'cursorDown'
  | 'none'

export interface GestureContext {
  /** 連著 agent 且 Keynote 有開著簡報。否則走離線快取。 */
  live: boolean
  mode: ControlMode
  cursorLine: number
  lineCount: number
}

/**
 * 取出使用者手勢，兩個來源都要看。
 *
 * ⚠️ 真機與模擬器的事件來源不同：**真機把手勢放在 `sysEvent`，模擬器放在 `textEvent`**。
 * 只檢查其中一個的 app，在另一邊會完全收不到輸入——而且是靜默失敗，沒有任何錯誤。
 * 社群把這一條列為「works in sim, broken on hardware」的頭號原因。
 *
 * @returns 手勢碼，或 null 表示這不是使用者手勢
 */
export function gestureOf(event: Pick<EvenHubEvent, 'sysEvent' | 'textEvent'>): number | null {
  const sys = event.sysEvent

  // 4–8 是系統事件（前景進出、異常斷線、系統退出、IMU），10 是長按放開，都不是要處理的手勢
  if (sys?.eventType !== undefined && sys.eventType >= 4 && sys.eventType !== LONG_PRESS) return null

  // protobuf 會把零值省略，所以 eventType 為 undefined 時代表單擊（0）
  if (event.textEvent) return event.textEvent.eventType ?? CLICK
  if (sys) return sys.eventType ?? CLICK
  return null
}

/** 回上一張：戒指模式才叫 Keynote 倒退；自己翻模式由 Keynote 當家，不下令。 */
function prev(ctx: GestureContext): GestureAction {
  if (!ctx.live) return 'localPrev'
  return ctx.mode === 'ring' ? 'sendPrev' : 'none'
}

export function routeGesture(g: number, ctx: GestureContext): GestureAction {
  switch (g) {
    // 雙擊代表離開。這是上架審核的必檢項目，不能拿去做別的。
    case DOUBLE_CLICK:
      return 'exit'

    // 長按＝回上一張。雙擊已經被「離開」佔走，所以回上一張只能用長按。
    // ⚠️ 戒指／鏡腿實機會不會送長按尚待驗證，所以另外保留「第一行再上滑」這條路。
    case LONG_PRESS:
      return prev(ctx)

    // 戒指模式：上滑＝上一張、下滑＝下一步（有動畫先播動畫），箭頭交給語音跟隨。
    // 舊規則「箭頭在第一行才翻頁」讓上一頁要連滑好幾下，實機感覺像戒指不靈敏（2026-09-27）。
    case SWIPE_UP:
      if (ctx.live && ctx.mode === 'ring') return 'sendPrev'
      return ctx.cursorLine === 0 ? prev(ctx) : 'cursorUp'

    case SWIPE_DOWN:
      if (ctx.live && ctx.mode === 'ring') return 'sendNext'
      return 'cursorDown'

    case CLICK:
      if (!ctx.live) {
        // 離線：先把這張的講稿走完，再自己推進到下一張，
        // 一個手勢就能走完全程，不必記得現在該滑還是該按。
        return ctx.cursorLine < ctx.lineCount - 1 ? 'cursorDown' : 'localNext'
      }
      return ctx.mode === 'ring' ? 'sendNext' : 'cursorDown'

    default:
      return 'none'
  }
}
