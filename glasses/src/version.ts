/**
 * 電腦端（Mac agent）版本檢查。
 *
 * 眼鏡端由 Even app 自動更新，電腦端 SlideCue.app 卻不會——使用者從 GitHub 下載一次後
 * 就一直用那一版。眼鏡端新功能若需要新版電腦端配合（心跳重連、戒指提速），
 * 舊使用者不會知道要去更新。所以 agent 在 info 裡回報自己的版本，
 * 眼鏡端比對後在手機設定頁提示「請重新下載電腦端」。
 *
 * 這支檔案 agent 與眼鏡端共用（agent 直接 import），兩邊的版本號不會漂移。
 */

/** 這一版電腦端的版本號。改了 agent 並要發新 Release 時一起升。 */
export const AGENT_VERSION = '1.1.0'

/** 眼鏡端要求的最低電腦端版本。低於它就提示更新。 */
export const MIN_AGENT_VERSION = '1.1.0'

/** 給使用者下載新版電腦端的地方（說明頁，下載按鈕指向 GitHub 最新 Release）。 */
export const AGENT_DOWNLOAD_URL = 'https://slidecue.pages.dev/'

/** 比較 x.y.z 版本號：a < b 回負數、相等 0、a > b 回正數。缺的位數當 0。 */
export function compareVersion(a: string, b: string): number {
  const pa = a.split('.').map(n => Number.parseInt(n, 10) || 0)
  const pb = b.split('.').map(n => Number.parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

/**
 * 電腦端是否太舊。
 *
 * 1.0.0（2026-08 第一版）還不會回報版本，所以「沒回報」一律視為太舊。
 */
export function agentOutdated(reported: string | undefined, min = MIN_AGENT_VERSION): boolean {
  if (!reported) return true
  return compareVersion(reported, min) < 0
}
