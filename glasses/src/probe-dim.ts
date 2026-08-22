/**
 * 區間亮度探針（真機用）。
 *
 * 要回答的問題：G2 能不能把「一段文字」單獨調暗，藉此做出提詞器
 * 「念過的字變暗」的效果。
 *
 * 為什麼要真機測：SDK 0.0.14 定義了 `textColor`（亮度 0~4），還附了
 * MIN/MAX_TEXT_BRIGHTNESS 常數與專屬驗證函式；但模擬器 0.8.0 與 0.9.0
 * 都回報 `unknown field textColor`，顯然協定還沒跟上韌體。模擬器測不出來，
 * 不等於真機做不到。
 *
 * 測試分三階段，每一階段的結果都直接寫在鏡片上，戴著就能判讀：
 *   A. 整個容器調暗   → 驗證 textColor 這個欄位在真機上到底能不能用
 *   B. 只調暗前半段   → 驗證能不能做「區間著色」（這才是逐字變暗的關鍵）
 *   C. 雙容器分段     → 就算 B 不行，這條退路一定可行
 *
 * 用法：npx evenhub qr → 掃描 → 用 Even app 開這一頁（/probe-dim.html）
 */

import {
  waitForEvenAppBridge,
  CreateStartUpPageContainer,
  TextContainerProperty,
  TextContainerUpgrade,
} from '@evenrealities/even_hub_sdk'

const SPOKEN = '這一段假裝已經念過了'
const AHEAD = '這一段假裝還沒有念到'

const bridge = await waitForEvenAppBridge()

/** 執行一個測試步驟，把成功與否記下來，絕不讓例外中斷後續步驟。 */
async function attempt(label: string, fn: () => Promise<unknown>): Promise<string> {
  try {
    const r = await fn()
    const ok = r === true || r === 0
    console.log(`[probe-dim] ${label}: ${ok ? 'OK' : `回傳 ${JSON.stringify(r)}`}`)
    return ok ? `${label} OK` : `${label} 回傳 ${JSON.stringify(r)}`
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.log(`[probe-dim] ${label}: 例外 ${msg}`)
    return `${label} 失敗`
  }
}

// ── 先建立頁面。刻意不帶 textColor，確保這一步一定成功 ──────────
const results: string[] = []

results.push(
  await attempt('建立', () =>
    bridge.createStartUpPageContainer(
      new CreateStartUpPageContainer({
        containerTotalNum: 3,
        textObject: [
          new TextContainerProperty({
            xPosition: 0, yPosition: 0, width: 576, height: 60,
            paddingLength: 4, borderWidth: 0,
            containerID: 1, containerName: 'target',
            isEventCapture: 1,
            content: `${SPOKEN}${AHEAD}`,
          }),
          // C 方案的對照組：兩個容器各自設不同亮度，這條路一定可行
          new TextContainerProperty({
            xPosition: 0, yPosition: 70, width: 576, height: 40,
            paddingLength: 4, borderWidth: 0,
            containerID: 2, containerName: 'twoA',
            isEventCapture: 0,
            content: `${SPOKEN}（這行等一下整個調暗）`,
          }),
          new TextContainerProperty({
            xPosition: 0, yPosition: 115, width: 576, height: 165,
            paddingLength: 4, borderWidth: 0,
            containerID: 3, containerName: 'report',
            isEventCapture: 0,
            content: '測試進行中…',
          }),
        ],
      }),
    ),
  ),
)

// ── B：只把前半段調暗（逐字變暗的關鍵）──────────────────────────
results.push(
  await attempt('B區間調暗', () =>
    bridge.textContainerUpgrade(
      new TextContainerUpgrade({
        containerID: 1,
        containerName: 'target',
        contentOffset: 0,
        contentLength: SPOKEN.length,
        content: SPOKEN,
        textColor: 1,
      }),
    ),
  ),
)

// ── A：整個容器調暗 ─────────────────────────────────────────────
results.push(
  await attempt('A整體調暗', () =>
    bridge.textContainerUpgrade(
      new TextContainerUpgrade({
        containerID: 2,
        containerName: 'twoA',
        content: `${SPOKEN}（這行等一下整個調暗）`,
        textColor: 1,
      }),
    ),
  ),
)

// ── 把判讀說明寫回鏡片 ──────────────────────────────────────────
await bridge.textContainerUpgrade(
  new TextContainerUpgrade({
    containerID: 3,
    containerName: 'report',
    content:
      results.join('\n') +
      '\n\n判讀：\n' +
      '第一行前半暗後半亮 → 區間著色可行\n' +
      '第二行整行變暗 → 只有容器層級亮度\n' +
      '兩行都沒變 → 真機也不支援 textColor',
  }),
)

console.log('[probe-dim] 全部結果：', results)
