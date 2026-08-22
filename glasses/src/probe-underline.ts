/**
 * 底線探針。
 *
 * SDK 的文字容器沒有任何字型樣式屬性——沒有粗體、斜體，也沒有底線。
 * 所以「加底線」只能靠字元本身或容器邊框。這支把四種做法一次推到鏡片上，
 * 看哪一種在韌體字型下真的顯示得出來。
 *
 * 字型裡沒有的字元會被**靜默跳過**（不報錯、直接消失），所以一定要看實際畫面。
 *
 * 用法：evenhub-simulator http://localhost:5173/probe-underline.html
 */

import {
  waitForEvenAppBridge,
  CreateStartUpPageContainer,
  TextContainerProperty,
} from '@evenrealities/even_hub_sdk'

/** 方法 A：組合用低橫線 U+0332，接在每個字後面 */
const combining = (s: string) => [...s].map(c => c + '̲').join('')

/** 方法 B：ASCII 底線字元排在下一行 */
const asciiUnder = (s: string) => `${s}\n${'_'.repeat([...s].length * 2)}`

/** 方法 C：製表用橫線字元排在下一行（設計指南列為可用） */
const boxUnder = (s: string) => `${s}\n${'─'.repeat([...s].length)}`

const bridge = await waitForEvenAppBridge()

const result = await bridge.createStartUpPageContainer(
  new CreateStartUpPageContainer({
    containerTotalNum: 5,
    textObject: [
      new TextContainerProperty({
        xPosition: 0, yPosition: 0, width: 576, height: 30,
        paddingLength: 4, borderWidth: 0,
        containerID: 1, containerName: 'a',
        isEventCapture: 1,
        content: `A ${combining('現在')} 20:04`,
      }),
      new TextContainerProperty({
        xPosition: 0, yPosition: 32, width: 576, height: 56,
        paddingLength: 4, borderWidth: 0,
        containerID: 2, containerName: 'b',
        isEventCapture: 0,
        content: `B ${asciiUnder('現在')} 20:04`,
      }),
      new TextContainerProperty({
        xPosition: 0, yPosition: 90, width: 576, height: 56,
        paddingLength: 4, borderWidth: 0,
        containerID: 3, containerName: 'c',
        isEventCapture: 0,
        content: `C ${boxUnder('現在')} 20:04`,
      }),
      // 方法 D：容器邊框。這是唯一保證存在的視覺分隔手段，
      // 但它是四邊都有的框，不是底線。
      new TextContainerProperty({
        xPosition: 0, yPosition: 150, width: 150, height: 34,
        paddingLength: 4, borderWidth: 1, borderColor: 8, borderRadius: 4,
        containerID: 4, containerName: 'd1',
        isEventCapture: 0,
        content: 'D 現在 20:04',
      }),
      new TextContainerProperty({
        xPosition: 0, yPosition: 192, width: 576, height: 90,
        paddingLength: 4, borderWidth: 0,
        containerID: 5, containerName: 'legend',
        isEventCapture: 0,
        content:
          '判讀：哪一行的「現在」下面真的出現線？\n' +
          'A 組合字元 U+0332／B 底線字元 _／C 製表線 ─／D 容器邊框',
      }),
    ],
  }),
)

console.log('[probe-underline] 建立結果', result === 0 ? '成功' : `失敗(${result})`)
