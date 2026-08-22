import { getTextWidth } from '@evenrealities/pretext'
import { wrapLines, paginateLines, linesPerContainer, cursorColumn, LINE_HEIGHT } from '../src/lines.ts'

let pass = 0, fail = 0
function check(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  PASS ${name}`) }
  else { fail++; console.log(`  FAIL ${name} ${detail}`) }
}

/** 講稿容器實際可用寬度：576 - 箭頭欄 28 - padding 6*2 */
const W = 536

console.log('\n[1] 斷行不超寬')
{
  const text = '各位早安。今天要談的是急診常見的心電圖陷阱。第一個重點：不要只看 ST 段，要看整體型態，尤其是對側導程有沒有相對應的變化。這一點在臨床上非常重要。'
  const lines = wrapLines(text, W)
  check('確實斷成多行', lines.length > 1, `${lines.length} 行`)
  const widths = lines.map(getTextWidth)
  check('每行都不超過可用寬度', widths.every(w => w <= W),
    `最寬 ${Math.max(...widths)} / 上限 ${W}`)
  check('內容無遺失', lines.join('').replace(/\s/g, '') === text.replace(/\s/g, ''))
  check('沒有空行', lines.every(l => l.length > 0))
}

console.log('\n[2] 強制換行要保留')
{
  const lines = wrapLines('第一段\n第二段\n第三段', W)
  check('三個短段落各自成行', lines.length === 3, `${lines.length} 行`)
  check('順序正確', lines[0] === '第一段' && lines[2] === '第三段')
}

console.log('\n[3] 英文單字不被切斷')
{
  const text = 'The patient presented with adenosine refractory supraventricular tachycardia today'
  const lines = wrapLines(text, 200)
  check('確實斷成多行', lines.length > 1, `${lines.length} 行`)
  const broken = lines.some(l => /^\w/.test(l) && lines.indexOf(l) > 0 &&
    !text.includes(' ' + l.split(' ')[0]))
  check('長單字沒有被切成兩半', !broken, lines.join(' | '))
  check('每行不超寬', lines.every(l => getTextWidth(l) <= 200),
    `最寬 ${Math.max(...lines.map(getTextWidth))}`)
}

console.log('\n[4] 邊界')
{
  check('空字串回傳單一空行', JSON.stringify(wrapLines('', W)) === JSON.stringify(['']))
  check('短文字不斷行', wrapLines('短句。', W).length === 1)
  const single = wrapLines('這是一個沒有任何空白的超長中文句子'.repeat(10), W)
  check('無空白長句仍能斷行', single.length > 1, `${single.length} 行`)
  check('無空白長句每行不超寬', single.every(l => getTextWidth(l) <= W))
}

console.log('\n[5] 分頁')
{
  const lines = Array.from({ length: 20 }, (_, i) => `第 ${i + 1} 行`)
  const pages = paginateLines(lines, 9)
  check('20 行切成 3 頁', pages.length === 3, `${pages.length} 頁`)
  check('前兩頁各 9 行', pages[0].length === 9 && pages[1].length === 9)
  check('末頁 2 行', pages[2].length === 2, `${pages[2].length} 行`)
  check('內容無遺失', pages.flat().join('|') === lines.join('|'))
}

console.log('\n[6] 容器容納行數')
{
  check('行高常數為 27', LINE_HEIGHT === 27)
  check('258px 含 padding 6 容納 9 行', linesPerContainer(258, 6) === 9,
    `實得 ${linesPerContainer(258, 6)}`)
  check('288px 無 padding 容納 10 行', linesPerContainer(288) === 10,
    `實得 ${linesPerContainer(288)}`)
  check('高度過小仍至少回傳 1', linesPerContainer(10) === 1)
}

console.log('\n[7] 箭頭欄定位')
{
  const ROWS = 6
  check('第 0 行：箭頭在最上面', cursorColumn(0, ROWS).split('\n')[0] === '▶')
  check('第 3 行：箭頭在第 4 列', cursorColumn(3, ROWS).split('\n')[3] === '▶')
  check('負值不顯示箭頭', !cursorColumn(-1, ROWS).includes('▶'))
  check('超出範圍不顯示箭頭', !cursorColumn(99, ROWS).includes('▶'))

  // 這是防止實機抖動的關鍵不變量：不論箭頭在哪，送出去的行數都一樣。
  // 行數一變，韌體就要重算捲動，整段講稿會跟著箭頭上下跳。
  const heights = [0, 1, 3, 5, -1, 99].map(i => cursorColumn(i, ROWS).split('\n').length)
  check('行數恆定，與箭頭位置無關', heights.every(h => h === ROWS))

  check('每頁只有一個箭頭', (cursorColumn(2, ROWS).match(/▶/g) ?? []).length === 1)
  check('只用字型支援的字元', /^[\n▶ ]*$/.test(cursorColumn(5, ROWS)))
}

console.log(`\n結果: ${pass} 通過 / ${fail} 失敗\n`)
process.exit(fail > 0 ? 1 : 0)
