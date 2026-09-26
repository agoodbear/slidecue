import { readFileSync } from 'node:fs'
import { SCRIPT_H, CURSOR_H } from '../src/ui.ts'
import { LINE_HEIGHT } from '../src/lines.ts'

let pass = 0, fail = 0
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) { pass++; console.log(`  PASS ${name}`) }
  else { fail++; console.log(`  FAIL ${name} ${detail}`) }
}

const src = readFileSync(new URL('../src/ui.ts', import.meta.url), 'utf8')

console.log('\n[1] 講稿欄與箭頭欄都不吃事件')
{
  // 講稿欄吃事件：韌體把滑動當成捲動，講稿自己晃（2026-08-21）。
  // 箭頭欄吃事件：就算沒有可捲空間，每次滑動箭頭還是會抖一下（2026-09-27 戒指實測，
  // 那段時間箭頭欄一次都沒重繪）。所以事件交給全螢幕的隱形底層。
  const blocks = [...src.matchAll(
    /containerID: ID\.(\w+),[\s\S]{0,600}?isEventCapture: (\d)/g,
  )].map(m => ({ id: m[1]!, cap: m[2]! }))

  const script = blocks.filter(b => b.id === 'script')
  const cursor = blocks.filter(b => b.id === 'cursor')

  check(`找得到講稿欄（${script.length} 處）`, script.length >= 2)
  check(`找得到箭頭欄（${cursor.length} 處）`, cursor.length >= 2)
  check('講稿欄一律不吃事件', script.every(b => b.cap === '0'),
    script.map(b => b.cap).join(','))
  check('箭頭欄一律不吃事件', cursor.every(b => b.cap === '0'),
    cursor.map(b => b.cap).join(','))
  const input = blocks.filter(b => b.id === 'input')
  check('隱形底層吃事件', input.length === 1 && input[0]!.cap === '1')
  const layer = src.slice(src.indexOf('function inputLayer'), src.indexOf('function inputLayer') + 600)
  check('隱形底層內容只有空白', /content: ' '/.test(layer))
  check('隱形底層鋪滿全螢幕', /width: SCREEN_W/.test(layer) && /height: SCREEN_H/.test(layer))
}

console.log('\n[2] 每個講稿頁面恰好一個容器吃事件（韌體規定），且是最先宣告的隱形底層')
{
  for (const fnName of ['cuePage', 'cueStartUp']) {
    const i = src.indexOf(`export function ${fnName}`)
    check(`${fnName} 存在`, i >= 0)
    if (i < 0) continue
    const rest = src.slice(i + 1)
    const next = rest.search(/\nexport function /)
    // 去掉註解，並只看 textObject 陣列本身，避免數到註解或後面的輔助函式
    const whole = (next < 0 ? rest : rest.slice(0, next)).replace(/\/\/.*$/gm, '')
    const start = whole.indexOf('textObject: [')
    const body = whole.slice(0, whole.indexOf('\n    ],', start) + 1)
    const inline = [...body.matchAll(/isEventCapture: 1/g)].length
    const layers = [...body.matchAll(/inputLayer\(\)/g)].length
    check(`${fnName} 只有隱形底層吃事件（inline ${inline}、底層 ${layers}）`, inline === 0 && layers === 1)
    // 沒設 zOrderIndex 時照宣告順序疊，先宣告＝在最底下
    check(`${fnName} 隱形底層是 textObject 第一個`, /textObject: \[\s*inputLayer\(\)/.test(body))
    const total = body.match(/containerTotalNum: (\d+)/)?.[1]
    const count = (body.match(/topCell\(|new TextContainerProperty\(|inputLayer\(\)/g) ?? []).length
    check(`${fnName} containerTotalNum(${total}) 等於實際容器數(${count}) 且 ≤ 8`, Number(total) === count && count <= 8)
  }
}


console.log('\n[3] 箭頭欄不留可捲空間（保險：萬一又改回由它吃事件）')
{
  // 實機症狀：接收事件的容器只要還有一點多餘高度，滑動時韌體會試著捲它、
  // 捲不動又彈回來——看起來是「箭頭晃一晃才移動」「往上滑先往下再往上」。
  // 貼著內容高度切，橡皮筋效應就沒有發生的餘地。
  const PAD = 6
  const lines = Math.floor((SCRIPT_H - PAD * 2) / LINE_HEIGHT)

  const cursorSlack = (CURSOR_H - PAD * 2) - lines * LINE_HEIGHT
  check(`箭頭欄可捲空間為 ${cursorSlack}px`, cursorSlack === 0)

  check('箭頭欄高度不超過講稿欄', CURSOR_H <= SCRIPT_H)
  check(`箭頭欄仍放得下一整頁的 ${lines} 行`, CURSOR_H - PAD * 2 >= lines * LINE_HEIGHT)
}

console.log(`\n結果: ${pass} 通過 / ${fail} 失敗\n`)
process.exit(fail > 0 ? 1 : 0)
