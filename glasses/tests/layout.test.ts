import { readFileSync } from 'node:fs'
import { SCRIPT_H, CURSOR_H } from '../src/ui.ts'
import { LINE_HEIGHT } from '../src/lines.ts'

let pass = 0, fail = 0
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) { pass++; console.log(`  PASS ${name}`) }
  else { fail++; console.log(`  FAIL ${name} ${detail}`) }
}

const src = readFileSync(new URL('../src/ui.ts', import.meta.url), 'utf8')

console.log('\n[1] 事件必須掛在箭頭欄，不能掛在講稿欄')
{
  // 這是實機才會發現的問題：講稿欄吃事件時，韌體會把滑動當成「捲動這個容器」，
  // 自己把講稿捲來捲去，完全不經過我們的程式。症狀是講稿容器幾乎沒重繪、
  // 畫面卻一直晃。改掛到行數固定的箭頭欄，韌體就沒有東西可以捲。
  const blocks = [...src.matchAll(
    /containerID: ID\.(\w+),[\s\S]{0,600}?isEventCapture: (\d)/g,
  )].map(m => ({ id: m[1]!, cap: m[2]! }))

  const script = blocks.filter(b => b.id === 'script')
  const cursor = blocks.filter(b => b.id === 'cursor')

  check(`找得到講稿欄（${script.length} 處）`, script.length >= 2)
  check(`找得到箭頭欄（${cursor.length} 處）`, cursor.length >= 2)
  check('講稿欄一律不吃事件', script.every(b => b.cap === '0'),
    script.map(b => b.cap).join(','))
  check('箭頭欄一律吃事件', cursor.every(b => b.cap === '1'),
    cursor.map(b => b.cap).join(','))
}

console.log('\n[2] 每個講稿頁面恰好一個容器吃事件（韌體規定）')
{
  for (const fnName of ['cuePage', 'cueStartUp']) {
    const i = src.indexOf(`export function ${fnName}`)
    check(`${fnName} 存在`, i >= 0)
    if (i < 0) continue
    // 取到下一個 top-level function 為止
    const rest = src.slice(i + 1)
    const next = rest.search(/\nexport function /)
    const body = next < 0 ? rest : rest.slice(0, next)
    const ones = [...body.matchAll(/containerID: ID\.(\w+),[\s\S]{0,600}?isEventCapture: 1/g)]
      .map(m => m[1])
    check(`${fnName} 只有一個容器吃事件：${ones.join(',') || '無'}`, ones.length === 1)
    check(`${fnName} 吃事件的是箭頭欄`, ones[0] === 'cursor')
  }
}


console.log('\n[3] 吃事件的容器不可以有可捲空間')
{
  // 實機症狀：接收事件的容器只要還有一點多餘高度，滑動時韌體會試著捲它、
  // 捲不動又彈回來——看起來是「箭頭晃一晃才移動」「往上滑先往下再往上」。
  // 貼著內容高度切，橡皮筋效應就沒有發生的餘地。
  const PAD = 6
  const lines = Math.floor((SCRIPT_H - PAD * 2) / LINE_HEIGHT)

  const cursorSlack = (CURSOR_H - PAD * 2) - lines * LINE_HEIGHT
  check(`箭頭欄（吃事件）可捲空間為 ${cursorSlack}px`, cursorSlack === 0)

  check('箭頭欄高度不超過講稿欄', CURSOR_H <= SCRIPT_H)
  check(`箭頭欄仍放得下一整頁的 ${lines} 行`, CURSOR_H - PAD * 2 >= lines * LINE_HEIGHT)
}

console.log(`\n結果: ${pass} 通過 / ${fail} 失敗\n`)
process.exit(fail > 0 ? 1 : 0)
