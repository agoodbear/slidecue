import { coalesce, resetCoalesce } from '../src/coalesce.ts'

let pass = 0, fail = 0
function check(name: string, ok: boolean): void {
  if (ok) { pass++; console.log(`  PASS ${name}`) }
  else { fail++; console.log(`  FAIL ${name}`) }
}
const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms))

console.log('\n[1] 連續請求會被合併')
{
  resetCoalesce()
  let drawn = 0
  let latest = 0
  const draw = async (): Promise<void> => { drawn++; latest = value; await sleep(30) }

  // 模擬使用者快速滑動 10 下，每下 5ms——遠快於一次繪製的 30ms
  let value = 0
  const tasks: Array<Promise<void>> = []
  for (let i = 1; i <= 10; i++) {
    value = i
    tasks.push(coalesce('cursor', draw))
    await sleep(5)
  }
  await Promise.all(tasks)
  await sleep(60)

  check(`10 次請求沒有變成 10 次繪製（實際 ${drawn} 次）`, drawn < 10)
  check('至少畫了 2 次（首次 + 補畫）', drawn >= 2)
  check(`最後畫的是最新狀態 ${latest} 而不是中途的舊值`, latest === 10)
}

console.log('\n[2] 補畫用的是當下的值，不是排隊時的值')
{
  resetCoalesce()
  const seen: number[] = []
  let value = 1
  const draw = async (): Promise<void> => { seen.push(value); await sleep(40) }

  const a = coalesce('x', draw)   // 立刻開始畫，看到 1
  await sleep(10)
  value = 2
  const b = coalesce('x', draw)   // 在飛，只標記
  await sleep(5)
  value = 3                        // 補畫前又變了
  const c = coalesce('x', draw)   // 已標記，不重複
  await Promise.all([a, b, c])
  await sleep(60)

  check('只畫了 2 次（不是 3 次）', seen.length === 2)
  check(`補畫看到的是 3（最新）而不是 2（排隊時的值）：${seen.join(',')}`, seen[1] === 3)
}

console.log('\n[3] 不同目標互不阻塞')
{
  resetCoalesce()
  const order: string[] = []
  const mk = (n: string) => async (): Promise<void> => { order.push(n); await sleep(20) }
  await Promise.all([coalesce('cursor', mk('cursor')), coalesce('script', mk('script'))])
  check('兩個目標都畫到了', order.includes('cursor') && order.includes('script'))
}

console.log('\n[4] 繪製失敗不會卡死後續')
{
  resetCoalesce()
  let n = 0
  const bad = async (): Promise<void> => { n++; throw new Error('藍牙斷了') }
  await coalesce('e', bad).catch(() => {})
  await coalesce('e', bad).catch(() => {})
  check(`丟出錯誤後仍能再次繪製（${n} 次）`, n === 2)
}

console.log(`\n結果: ${pass} 通過 / ${fail} 失敗\n`)
process.exit(fail > 0 ? 1 : 0)
