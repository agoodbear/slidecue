import { scrollToShow, LOOKAHEAD_LINES } from '../src/lines.ts'

let pass = 0, fail = 0
function check(name: string, ok: boolean): void {
  if (ok) { pass++; console.log(`  PASS ${name}`) }
  else { fail++; console.log(`  FAIL ${name}`) }
}

const PER = 8   // 鏡片一頁 8 行（實測 SCRIPT_H 252px ÷ 行高 27px）

console.log('\n[1] 實機遇到的情形：講稿 12 行、分成兩頁')
{
  const TOTAL = 12
  // 念前幾行時不該亂捲
  let start = 0
  for (const line of [0, 1, 2, 3, 4, 5]) {
    start = scrollToShow(line, 0, TOTAL, PER)
    if (line <= 5) check(`第 ${line} 行：還看得到下面，不捲動`, start === 0)
  }

  // 第 6 行 = 倒數第 2 行，這裡就該捲了（原本要到第 8 行才捲）
  const at6 = scrollToShow(6, 0, TOTAL, PER)
  check('第 6 行（倒數第 2 行）：提前捲動', at6 > 0)

  // 捲完之後，箭頭下面必須真的還看得到東西
  const visibleBelow = (at6 + PER) - 6 - 1
  check(`捲動後箭頭下方仍有 ${visibleBelow} 行可看（至少 ${LOOKAHEAD_LINES}）`, visibleBelow >= LOOKAHEAD_LINES)
}

console.log('\n[2] 念到最後不能出現空白')
{
  const TOTAL = 12
  const maxStart = TOTAL - PER      // 4
  for (const line of [9, 10, 11]) {
    const st = scrollToShow(line, 4, TOTAL, PER)
    check(`第 ${line} 行：起始行不超過 ${maxStart}（不留空白）`, st <= maxStart)
    check(`第 ${line} 行：箭頭仍在可見範圍內`, line >= st && line < st + PER)
  }
}

console.log('\n[3] 講稿比一頁短：完全不該捲')
{
  const TOTAL = 5
  for (const line of [0, 2, 4]) {
    check(`第 ${line} 行：${TOTAL} 行放得下，維持在 0`, scrollToShow(line, 0, TOTAL, PER) === 0)
  }
}

console.log('\n[4] 往回滑也要跟得上')
{
  const TOTAL = 30
  const back = scrollToShow(3, 20, TOTAL, PER)
  check('往回滑到第 3 行時捲回去', back < 20)
  check('往回滑後箭頭在可見範圍內', 3 >= back && 3 < back + PER)
}

console.log('\n[5] 任何位置，箭頭永遠看得見（全面掃描）')
{
  for (const TOTAL of [1, 5, 8, 9, 12, 40, 200]) {
    let start = 0
    let ok = true
    let belowOk = true
    for (let line = 0; line < TOTAL; line++) {
      start = scrollToShow(line, start, TOTAL, PER)
      if (line < start || line >= start + PER) ok = false
      // 只要後面還有內容，就必須看得到至少一行
      if (line + 1 < TOTAL && line + 1 >= start + PER) belowOk = false
      if (start < 0 || start > Math.max(0, TOTAL - PER)) ok = false
    }
    check(`講稿 ${TOTAL} 行：逐行念完，箭頭始終可見且不留空白`, ok)
    check(`講稿 ${TOTAL} 行：下一行始終看得見（不會念到才出現）`, belowOk)
  }
}

console.log(`\n結果: ${pass} 通過 / ${fail} 失敗\n`)
process.exit(fail > 0 ? 1 : 0)
