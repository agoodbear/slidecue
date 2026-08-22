/**
 * 字型探針。
 *
 * G2 韌體只內建一套 LVGL 字型，字型裡沒有的字元會被**靜默跳過**——
 * 不會報錯、不會顯示替代字，就是憑空消失。這對倒數計時的警示符號是致命的：
 * 程式看起來一切正常，眼鏡上卻少了那個提醒。
 *
 * 這支把所有預定使用的字元推到眼鏡上，用模擬器截圖肉眼確認哪些真的顯示得出來。
 *
 * 用法：evenhub-simulator http://localhost:5173/probe.html
 */

import {
  waitForEvenAppBridge,
  CreateStartUpPageContainer,
  TextContainerProperty,
} from '@evenrealities/even_hub_sdk'

const LINES = [
  '1 時間符號 ▶ ▽ ▼ ▲ ▸',
  '2 進度條 ▇▇▇▇▇▁▁▁▁▁',
  '3 狀態 ● ○ ■ □ ★ ☆ ✕',
  '4 方向 ◀ ◁ ▶ ▷ ▲ △ ▼ ▽',
  '5 實例 14:35   ▶8:42   ▽21:18',
  '6 警示 ▶28:42   ▼1:18 ▇▇▁▁▁▁▁▁▁▁',
  '7 超時 ▶33:20   ▲+3:20',
  '8 頁碼 183/183 ▸2/3 1/2',
]

const bridge = await waitForEvenAppBridge()

const result = await bridge.createStartUpPageContainer(
  new CreateStartUpPageContainer({
    containerTotalNum: 1,
    textObject: [
      new TextContainerProperty({
        xPosition: 0,
        yPosition: 0,
        width: 576,
        height: 288,
        paddingLength: 4,
        borderWidth: 0,
        containerID: 1,
        containerName: 'probe',
        isEventCapture: 1,
        content: LINES.join('\n'),
      }),
    ],
  }),
)

console.log('[probe] 建立結果', result === 0 ? '成功' : `失敗(${result})`)
