import { buildDeck } from '../src/deck.ts'

let pass = 0, fail = 0
function check(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  PASS ${name}`) }
  else { fail++; console.log(`  FAIL ${name} ${detail}`) }
}

console.log('\n[1] 全部都有自己的稿')
{
  const d = buildDeck(['A', 'B', 'C'])
  check('沒有任何一張被標成繼承', d.every(s => !s.inherited))
  check('鏈長都是 1', d.every(s => s.inheritTotal === 1))
  check('內容原樣保留', d.map(s => s.notes).join('') === 'ABC')
}

console.log('\n[2] 空白沿用前一張')
{
  const d = buildDeck(['A', '', '', 'B', ''])
  check('第 2 張沿用 A', d[1].notes === 'A' && d[1].inherited)
  check('第 3 張沿用 A', d[2].notes === 'A' && d[2].inherited)
  check('第 4 張用自己的 B', d[3].notes === 'B' && !d[3].inherited)
  check('第 5 張沿用 B', d[4].notes === 'B' && d[4].inherited)
  check('A 鏈長度為 3', d.slice(0, 3).every(s => s.inheritTotal === 3),
    `實得 ${d.slice(0, 3).map(s => s.inheritTotal).join(',')}`)
  check('B 鏈長度為 2', d.slice(3).every(s => s.inheritTotal === 2),
    `實得 ${d.slice(3).map(s => s.inheritTotal).join(',')}`)
  check('鏈內序號遞增', d[0].inheritIndex === 1 && d[1].inheritIndex === 2 && d[2].inheritIndex === 3)
  check('新鏈序號重新起算', d[3].inheritIndex === 1 && d[4].inheritIndex === 2)
}

console.log('\n[3] 開頭就空白（前面無稿可繼承）')
{
  const d = buildDeck(['', '', 'A'])
  check('開頭兩張維持空稿', d[0].notes === '' && d[1].notes === '')
  check('不會誤標成繼承', !d[0].inherited && !d[1].inherited)
  check('第 3 張正常', d[2].notes === 'A' && d[2].inheritTotal === 1)
}

console.log('\n[4] 邊界')
{
  check('空陣列不炸', buildDeck([]).length === 0)
  check('單張正常', buildDeck(['A'])[0].inheritTotal === 1)
  check('全空白不炸', buildDeck(['', '']).every(s => s.notes === ''))
  const ws = buildDeck(['  A  ', '   '])
  check('只有空白字元視為空稿', ws[1].inherited && ws[1].notes === 'A')
}

console.log(`\n結果: ${pass} 通過 / ${fail} 失敗\n`)
process.exit(fail > 0 ? 1 : 0)
