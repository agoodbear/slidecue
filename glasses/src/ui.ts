/**
 * G2 畫面組裝。
 *
 * 這塊螢幕沒有 CSS、沒有排版引擎、沒有文字對齊，一切都是絕對座標的像素容器。
 * 需要「靠右」時的正解是給它自己一個容器擺到右邊，而不是在同一段文字裡補空格
 * ——G2 字型不是等寬的，補空格實測會歪。版面計算集中在這裡，別處不要自己算座標。
 */

import {
  CreateStartUpPageContainer,
  RebuildPageContainer,
  TextContainerProperty,
  ListContainerProperty,
  ListItemContainerProperty,
  TextContainerUpgrade,
} from '@evenrealities/even_hub_sdk'
import { LINE_HEIGHT } from './lines.ts'

/** G2 單眼畫布尺寸。 */
export const SCREEN_W = 576
export const SCREEN_H = 288

/**
 * 頂端資訊列高度。
 *
 * 26px 只夠放一行裸字；改成三個帶邊框的獨立容器後需要 32px
 * （邊框 1px + padding 3px，上下各 4px，加上韌體行高 27px 需要 35px，
 * 實測 32px 剛好容得下不裁切）。
 * 講稿區因此少 6px，但 252 / 27 仍是 9 行，不損失任何一行。
 */
const BAR_H = 32

/**
 * 左側箭頭欄寬度。
 *
 * `▶` 實測 20px，加上左右各 6px padding 正好 32px。
 * 箭頭獨立成一欄，是為了讓它移動時講稿一個字都不必重排。
 */
const CURSOR_W = 32

/** 講稿區與箭頭欄共用的 padding，兩者必須一致，否則行基線會錯開。 */
const TEXT_PAD = 6

/** 講稿區實際可用的文字寬度，斷行計算要用這個值。 */
export const SCRIPT_TEXT_W = SCREEN_W - CURSOR_W - TEXT_PAD * 2

/** 講稿區高度。 */
export const SCRIPT_H = SCREEN_H - BAR_H - 4

/**
 * 箭頭欄的高度：**剛好裝滿內容，一點多餘空間都不留**。
 *
 * 這是實機才會發現的問題。接收事件的容器如果還有可捲空間，使用者滑動時
 * 韌體會試著捲它、捲不動又彈回來——看起來就是「箭頭晃一晃才移動」、
 * 「往上滑時先往下再往上」。
 *
 * 講稿欄高 252px、可用 240px，但內容只有 8 行 216px，剩下 24px 就夠它晃。
 * 箭頭欄改成貼著內容高度切，可捲空間歸零，橡皮筋效應就沒有發生的餘地。
 */
const CURSOR_LINES = Math.floor((SCRIPT_H - TEXT_PAD * 2) / LINE_HEIGHT)
export const CURSOR_H = CURSOR_LINES * LINE_HEIGHT + TEXT_PAD * 2

/**
 * 頂端四個欄位的座標與寬度。
 *
 * 三段時間各自獨立成容器、各自加邊框，有兩個好處：
 *  1. 視覺上分組清楚（G2 沒有底線屬性，實測組合字元 U+0332 也畫不出線，
 *     只有容器邊框能在單行高度內做出分隔）
 *  2. 位置固定——授課時間從 `0:17` 變成 `1:01:40` 時，後面兩組不會被推著跑。
 *     台上畫面裡的東西亂動，比沒有分隔線更干擾。
 *
 * 寬度都是用 pretext 量過最長情況再加 padding 決定的，不是估的。
 */
const TOP = {
  now:      { x: 0,   w: 116 },  // 「現在 09:05」實測 98px
  elapsed:  { x: 120, w: 126 },  // 「授課 2:15:30」實測 108px
  countdown:{ x: 250, w: 196 },  // 「倒數 4:32 ▇▇▇▁」實測 170px
  pageno:   { x: 450, w: 126 },  // 「12/48 ▷2/3」實測 103px
} as const

/**
 * 各欄位的可用文字寬度。
 *
 * 扣掉邊框(1)、padding(3)，還要再扣**捲軸指示線**——韌體會在每個文字容器
 * 右緣畫一條豎線，實測約佔 10px。這件事文件沒寫，是看模擬器截圖才發現的：
 * 第一版配置沒扣它，「現在 20:13」的數字就直接頂到那條線上。
 */
const SCROLLBAR_W = 10
const INSET = 2 * (1 + 3) + SCROLLBAR_W
export const NOW_TEXT_W = TOP.now.w - INSET
export const ELAPSED_TEXT_W = TOP.elapsed.w - INSET
export const COUNTDOWN_TEXT_W = TOP.countdown.w - INSET
export const PAGENO_TEXT_W = TOP.pageno.w - INSET



export const ID = {
  title: 1,
  menu: 2,
  now: 3,
  script: 4,
  pageno: 5,
  cursor: 6,
  elapsed: 7,
  countdown: 8,
} as const

export const NAME = {
  title: 'title',
  menu: 'menu',
  now: 'now',
  script: 'script',
  pageno: 'pageno',
  cursor: 'cursor',
  elapsed: 'elapsed',
  countdown: 'countdown',
} as const

/** 選單頁：標題 + 選項清單。模式選擇與時長選擇共用這個版型。 */
export function menuPage(title: string, items: string[]): CreateStartUpPageContainer {
  return new CreateStartUpPageContainer({
    containerTotalNum: 2,
    textObject: [
      new TextContainerProperty({
        xPosition: 0,
        yPosition: 0,
        width: SCREEN_W,
        // 兩行中文加上下 padding 需要約 60px；設 44 會把第二行切掉一半
        height: 62,
        paddingLength: 6,
        borderWidth: 0,
        containerID: ID.title,
        containerName: NAME.title,
        isEventCapture: 0,
        content: title,
      }),
    ],
    listObject: [listBlock(items)],
  })
}

/** 選單頁的重建版本（從一個選單切到下一個選單時用）。 */
export function menuRebuild(title: string, items: string[]): RebuildPageContainer {
  return new RebuildPageContainer({
    containerTotalNum: 2,
    textObject: [
      new TextContainerProperty({
        xPosition: 0,
        yPosition: 0,
        width: SCREEN_W,
        height: 62,
        paddingLength: 6,
        borderWidth: 0,
        containerID: ID.title,
        containerName: NAME.title,
        isEventCapture: 0,
        content: title,
      }),
    ],
    listObject: [listBlock(items)],
  })
}

function listBlock(items: string[]): ListContainerProperty {
  return new ListContainerProperty({
    xPosition: 0,
    yPosition: 66,
    width: SCREEN_W,
    // list 會把項目垂直置中，容器給滿高會讓選項掉到畫面中央、離標題很遠。
    // 高度依項目數收緊，選單才會緊接在標題下方。
    height: Math.min(SCREEN_H - 70, Math.max(60, items.length * 34)),
    paddingLength: 6,
    borderWidth: 0,
    containerID: ID.menu,
    containerName: NAME.menu,
    isEventCapture: 1,
    itemContainer: new ListItemContainerProperty({
      itemCount: items.length,
      itemWidth: 0,
      isItemSelectBorderEn: 1,
      itemName: items,
    }),
  })
}

/**
 * 提詞主畫面。
 *
 * 六個容器：三段時間各自一欄（帶邊框分隔）、右上頁碼、左側箭頭欄、其餘給講稿。
 *
 * 時間拆成三個容器而不是一行字，是因為 G2 沒有底線屬性
 * （實測組合字元 U+0332 也畫不出線），只有容器邊框能在單行高度內做出分隔；
 * 而且各欄位置固定，時間變長時不會把後面的內容推著跑。
 */
export function cuePage(
  now: string,
  elapsed: string,
  countdown: string,
  pageno: string,
  cursor: string,
  script: string,
): RebuildPageContainer {
  return new RebuildPageContainer({
    containerTotalNum: 6,
    textObject: [
      topCell(ID.now, NAME.now, TOP.now, now),
      topCell(ID.elapsed, NAME.elapsed, TOP.elapsed, elapsed),
      topCell(ID.countdown, NAME.countdown, TOP.countdown, countdown),
      topCell(ID.pageno, NAME.pageno, TOP.pageno, pageno),
      new TextContainerProperty({
        xPosition: 0,
        yPosition: BAR_H + 4,
        width: CURSOR_W,
        // 貼著內容切，不留可捲空間——理由見 CURSOR_H 的說明
        height: CURSOR_H,
        paddingLength: TEXT_PAD,
        borderWidth: 0,
        containerID: ID.cursor,
        containerName: NAME.cursor,
        // ⚠️ 事件必須掛在箭頭欄，不能掛在講稿欄。
        //
        // 掛在講稿欄時，韌體會把滑動當成「捲動這個容器」而自己動起來，
        // 於是講稿在畫面上跟著手指晃，卻完全不經過我們的程式——
        // 實測講稿容器只重繪 2 次，畫面卻一直在動，就是這個原因。
        //
        // 箭頭欄的內容行數是固定的（見 lines.ts 的 cursorColumn），
        // 沒有可捲動的空間，韌體攔到事件也捲不動任何東西。
        isEventCapture: 1,
        content: cursor,
      }),
      new TextContainerProperty({
        xPosition: CURSOR_W,
        yPosition: BAR_H + 4,
        width: SCREEN_W - CURSOR_W,
        height: SCRIPT_H,
        paddingLength: TEXT_PAD,
        borderWidth: 0,
        containerID: ID.script,
        containerName: NAME.script,
        // 不吃事件——理由見上面箭頭欄的說明。捲動由我們自己算，
        // 讓韌體插手會讓畫面與箭頭位置對不起來。
        isEventCapture: 0,
        content: script,
      }),
    ],
  })
}

/** 頂端的單一欄位。邊框亮度壓低，才不會跟講稿搶注意力。 */
function topCell(
  id: number,
  name: string,
  box: { x: number; w: number },
  content: string,
): TextContainerProperty {
  return new TextContainerProperty({
    xPosition: box.x,
    yPosition: 0,
    width: box.w,
    height: BAR_H,
    paddingLength: 3,
    borderWidth: 1,
    // 0~15 的灰階，取中段：看得見分隔，但不會比內文更搶眼
    borderColor: 7,
    borderRadius: 4,
    containerID: id,
    containerName: name,
    isEventCapture: 0,
    content,
  })
}

/**
 * 提詞主畫面的啟動版本。
 *
 * 設定移到手機端之後，眼鏡一開啟就直接是講稿畫面、不再經過選單，
 * 所以需要 CreateStartUpPageContainer 而不是 Rebuild 版本。
 */
export function cueStartUp(
  now: string,
  elapsed: string,
  countdown: string,
  pageno: string,
  cursor: string,
  script: string,
): CreateStartUpPageContainer {
  return new CreateStartUpPageContainer({
    containerTotalNum: 6,
    textObject: [
      topCell(ID.now, NAME.now, TOP.now, now),
      topCell(ID.elapsed, NAME.elapsed, TOP.elapsed, elapsed),
      topCell(ID.countdown, NAME.countdown, TOP.countdown, countdown),
      topCell(ID.pageno, NAME.pageno, TOP.pageno, pageno),
      new TextContainerProperty({
        xPosition: 0,
        yPosition: BAR_H + 4,
        width: CURSOR_W,
        // 貼著內容切，不留可捲空間——理由見 CURSOR_H 的說明
        height: CURSOR_H,
        paddingLength: TEXT_PAD,
        borderWidth: 0,
        containerID: ID.cursor,
        containerName: NAME.cursor,
        // ⚠️ 事件必須掛在箭頭欄，不能掛在講稿欄。
        //
        // 掛在講稿欄時，韌體會把滑動當成「捲動這個容器」而自己動起來，
        // 於是講稿在畫面上跟著手指晃，卻完全不經過我們的程式——
        // 實測講稿容器只重繪 2 次，畫面卻一直在動，就是這個原因。
        //
        // 箭頭欄的內容行數是固定的（見 lines.ts 的 cursorColumn），
        // 沒有可捲動的空間，韌體攔到事件也捲不動任何東西。
        isEventCapture: 1,
        content: cursor,
      }),
      new TextContainerProperty({
        xPosition: CURSOR_W,
        yPosition: BAR_H + 4,
        width: SCREEN_W - CURSOR_W,
        height: SCRIPT_H,
        paddingLength: TEXT_PAD,
        borderWidth: 0,
        containerID: ID.script,
        containerName: NAME.script,
        // 不吃事件——理由見上面箭頭欄的說明。捲動由我們自己算，
        // 讓韌體插手會讓畫面與箭頭位置對不起來。
        isEventCapture: 0,
        content: script,
      }),
    ],
  })
}

/** 就地更新「現在」欄。 */
export function nowUpgrade(text: string): TextContainerUpgrade {
  return new TextContainerUpgrade({
    containerID: ID.now,
    containerName: NAME.now,
    content: text,
  })
}

/** 就地更新「授課」欄。 */
export function elapsedUpgrade(text: string): TextContainerUpgrade {
  return new TextContainerUpgrade({
    containerID: ID.elapsed,
    containerName: NAME.elapsed,
    content: text,
  })
}

/** 就地更新「下課倒數」欄。 */
export function countdownUpgrade(text: string): TextContainerUpgrade {
  return new TextContainerUpgrade({
    containerID: ID.countdown,
    containerName: NAME.countdown,
    content: text,
  })
}

/** 就地更新右上頁碼。 */
export function pagenoUpgrade(text: string): TextContainerUpgrade {
  return new TextContainerUpgrade({
    containerID: ID.pageno,
    containerName: NAME.pageno,
    content: text,
  })
}

/** 就地更新箭頭欄。念到下一行時只動這個容器，講稿不受影響。 */
export function cursorUpgrade(text: string): TextContainerUpgrade {
  return new TextContainerUpgrade({
    containerID: ID.cursor,
    containerName: NAME.cursor,
    content: text,
  })
}

/** 就地更新講稿。翻頁時走這條，才不會整頁閃爍。 */
export function scriptUpgrade(text: string): TextContainerUpgrade {
  return new TextContainerUpgrade({
    containerID: ID.script,
    containerName: NAME.script,
    content: text,
  })
}
