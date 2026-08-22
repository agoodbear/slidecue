/**
 * 以「行」為單位的講稿排版。
 *
 * 為什麼要自己斷行：G2 的文字容器會自動換行，但韌體換在哪裡程式端拿不到。
 * 只要我們不知道每一行的內容，「箭頭指著目前這一行」就無從實作。
 * 所以改成自己用 \n 明確斷好每一行——韌體收到已經斷好的文字就不會再折。
 *
 * 寬度用官方 @evenrealities/pretext 精算，那是對齊韌體 LVGL 排版引擎的量測，
 * 比自己估字元寬可靠得多（自製估算實測會低估約五成）。
 */

import { getTextWidth } from '@evenrealities/pretext'

/** 韌體固定行高，官方文件明訂。整個版面計算都靠這個常數。 */
export const LINE_HEIGHT = 27

/**
 * 把文字斷成一行一行，每行都保證不超過 maxWidth。
 *
 * 中文可以在任意字之間斷，英文單字則盡量不切斷——講稿裡的
 * `STEMI`、`adenosine` 被切成兩半會非常難念。
 *
 * @param text 原始文字，其中既有的 \n 會被視為強制斷行
 * @param maxWidth 一行可用的像素寬（要先扣掉 padding 與 border）
 */
export function wrapLines(text: string, maxWidth: number): string[] {
  const out: string[] = []

  for (const para of text.replace(/\r\n/g, '\n').split('\n')) {
    if (!para.trim()) {
      out.push('')
      continue
    }

    let cur = ''
    // 記住最後一個可安全斷開的位置（空白後、或中文字之間）
    let lastBreak = -1

    for (const ch of para) {
      const next = cur + ch

      if (getTextWidth(next) > maxWidth && cur) {
        if (lastBreak > 0 && lastBreak < cur.length) {
          // 退回到最後一個安全斷點，避免把英文單字切成兩半
          out.push(cur.slice(0, lastBreak).trimEnd())
          cur = cur.slice(lastBreak) + ch
        } else {
          out.push(cur)
          cur = ch
        }
        lastBreak = -1
      } else {
        cur = next
      }

      // 空白之後、以及 CJK 字之後，都是可以斷行的地方
      if (/\s/.test(ch) || isCjk(ch)) lastBreak = cur.length
    }

    if (cur.trim()) out.push(cur)
  }

  return out.length ? out : ['']
}

/** 把行切成一頁一頁。 */
export function paginateLines(lines: string[], linesPerPage: number): string[][] {
  if (linesPerPage < 1) return [lines]
  const pages: string[][] = []
  for (let i = 0; i < lines.length; i += linesPerPage) {
    pages.push(lines.slice(i, i + linesPerPage))
  }
  return pages.length ? pages : [['']]
}

/** 一個容器高度容得下幾行。 */
export function linesPerContainer(height: number, padding = 0): number {
  return Math.max(1, Math.floor((height - padding * 2) / LINE_HEIGHT))
}

/**
 * 箭頭欄的內容。
 *
 * 靠換行把箭頭推到對應的那一行——因為行高固定 27px，換行數量就是精準的
 * 垂直定位。箭頭自成一個容器，移動時講稿一個字都不會重排。
 *
 * @param lineIndex 頁內行號，0 起算；負數代表不顯示箭頭
 */
export function cursorColumn(lineIndex: number, rows: number): string {
  // ⚠️ 行數必須固定，不能用 '\n'.repeat(lineIndex) + '▶'。
  //
  // 那個寫法讓容器內容的行數隨箭頭位置改變（第 0 行是 1 行、第 5 行是 6 行），
  // 而這個容器是會捲動的——韌體每次收到不同行數就得重新決定排版與捲動位置，
  // 實機上看起來就是整段講稿跟著箭頭上下抖動。
  //
  // 改成永遠送滿 rows 行、只換箭頭在哪一行，韌體就沒有東西需要重算。
  // 空行用半形空格而不是空字串，避免被摺疊掉而讓行數又變回不固定。
  const out = new Array(Math.max(0, rows)).fill(' ')
  if (lineIndex >= 0 && lineIndex < out.length) out[lineIndex] = '▶'
  return out.join('\n')
}

function isCjk(ch: string): boolean {
  const c = ch.codePointAt(0)!
  return (
    (c >= 0x2e80 && c <= 0xa4cf) ||
    (c >= 0xac00 && c <= 0xd7a3) ||
    (c >= 0xf900 && c <= 0xfaff) ||
    (c >= 0xff00 && c <= 0xff60) ||
    (c >= 0x20000 && c <= 0x3fffd)
  )
}

/**
 * 箭頭下方至少要留幾行看得見。
 *
 * 這是提詞機的核心：講者需要**先看到接下來要念的字**，而不是念到了才出現。
 * 原本的邏輯是「箭頭跑出畫面才捲動」，那時候最後一行已經念完、
 * 下一行還沒出現，講者當場斷片——實機測試時就卡在這個情況。
 */
export const LOOKAHEAD_LINES = 2

/**
 * 算出這一頁該從第幾行開始顯示，才能讓箭頭附近的內容都看得到。
 *
 * 捲動時把箭頭帶到畫面**上方**而不是正中間，因為講者要看的是下面還沒念的部分，
 * 上面念過的留一兩行當作定位參考就夠了。這也讓捲動不必太頻繁——
 * 捲一次可以再念好幾行，而每次捲動都是一趟一百毫秒的藍牙重繪。
 *
 * @param cursorLine 箭頭在整份講稿的第幾行
 * @param pageStart  目前這一頁從第幾行開始
 * @param totalLines 這張投影片的講稿一共幾行
 * @param perPage    一頁看得見幾行
 * @returns 新的起始行；與 pageStart 相同代表不需要捲動
 */
export function scrollToShow(
  cursorLine: number,
  pageStart: number,
  totalLines: number,
  perPage: number,
  lookahead = LOOKAHEAD_LINES,
): number {
  // 捲到底之後不能再往下，否則畫面會出現空白
  const maxStart = Math.max(0, totalLines - perPage)
  const clamp = (n: number): number => Math.min(Math.max(0, n), maxStart)

  // 箭頭停在上方這個位置，下方就留得出前瞻空間
  const rest = Math.floor(perPage / 3)

  // 快碰到底部了（不是「已經超出」）——這就是提前捲動的關鍵
  if (cursorLine >= pageStart + perPage - lookahead) return clamp(cursorLine - rest)
  // 往回滑超出上緣
  if (cursorLine < pageStart) return clamp(cursorLine - rest)
  return pageStart
}
