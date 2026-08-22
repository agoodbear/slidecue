import {
  normalizeHost, prettyHost, isShortCode, expandShortCode,
  candidatesFromInput, COMMON_SUBNETS, AGENT_PORT,
} from '../src/host.ts'

let pass = 0, fail = 0
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) { pass++; console.log(`  PASS ${name}`) }
  else { fail++; console.log(`  FAIL ${name} ${detail}`) }
}

console.log('\n[1] 三位數連線碼的判定')
{
  for (const ok of ['1', '42', '199', '254']) {
    check(`「${ok}」是連線碼`, isShortCode(ok))
  }
  for (const no of ['0', '255', '256', '', '1.2', '192.168.0.1', 'abc', '19a']) {
    check(`「${no}」不是連線碼`, !isShortCode(no))
  }
}

console.log('\n[2] 連線碼展開成常見網段')
{
  const cs = expandShortCode('42')
  check(`展開成 ${cs.length} 個候選`, cs.length === COMMON_SUBNETS.length)
  check('每個都是完整的 ws 位址', cs.every(c => /^ws:\/\/[\d.]+:\d+$/.test(c)), cs[0])
  check('最後一段都是 42', cs.every(c => c.includes('.42:')))
  check('含最常見的 192.168.0.42', cs.includes(`ws://192.168.0.42:${AGENT_PORT}`))
  check('含最常見的 192.168.1.42', cs.includes(`ws://192.168.1.42:${AGENT_PORT}`))
  // 會場沒 Wi-Fi 時開 iPhone 熱點是最常見的情況，這個網段是固定的
  check('含 iPhone 熱點網段 172.20.10.42', cs.includes(`ws://172.20.10.42:${AGENT_PORT}`))
}

console.log('\n[3] 使用者輸入 → 候選清單')
{
  check('三位數 → 多個候選', candidatesFromInput('42').length === COMMON_SUBNETS.length)
  check('完整 IP → 單一候選', candidatesFromInput('192.168.5.42').length === 1)
  check('完整 IP 內容正確',
    candidatesFromInput('192.168.5.42')[0] === `ws://192.168.5.42:${AGENT_PORT}`)
  check('主機名稱 → 單一候選',
    candidatesFromInput('MacBook.local')[0] === `ws://MacBook.local:${AGENT_PORT}`)
  check('空字串 → 沒有候選', candidatesFromInput('   ').length === 0)
}

console.log('\n[4] 完整位址的各種寫法')
{
  const cases: Array<[string, string]> = [
    ['192.168.0.5',                    `ws://192.168.0.5:${AGENT_PORT}`],
    ['  192.168.0.5  ',                `ws://192.168.0.5:${AGENT_PORT}`],
    ['MacBook-Pro.local',              `ws://MacBook-Pro.local:${AGENT_PORT}`],
    ['http://192.168.0.5:8788/health', 'ws://192.168.0.5:8788'],
    ['ws://192.168.0.5:8788',          'ws://192.168.0.5:8788'],
    ['192.168.0.5:9999',               'ws://192.168.0.5:9999'],
  ]
  for (const [input, want] of cases) {
    check(`「${input}」→ ${want}`, normalizeHost(input) === want, `得到 ${normalizeHost(input)}`)
  }
  for (const empty of ['', '   ', 'ws://', 'http://']) {
    check(`「${empty}」→ 空`, normalizeHost(empty) === '')
  }
}

console.log('\n[5] 顯示與來回轉換')
{
  check('去掉協定與預設埠號', prettyHost(`ws://192.168.0.5:${AGENT_PORT}`) === '192.168.0.5')
  check('保留非預設埠號', prettyHost('ws://192.168.0.5:9999') === '192.168.0.5:9999')
  check('null → 空字串', prettyHost(null) === '')
  for (const h of ['192.168.0.5', 'mac.local', '192.168.0.5:9999']) {
    check(`${h} 來回轉換不失真`, prettyHost(normalizeHost(h)) === h)
  }
}

console.log(`\n結果: ${pass} 通過 / ${fail} 失敗\n`)
process.exit(fail > 0 ? 1 : 0)
