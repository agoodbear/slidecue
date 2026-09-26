import { compareVersion, agentOutdated, AGENT_VERSION, MIN_AGENT_VERSION } from '../src/version.ts'

let pass = 0, fail = 0
function check(name: string, ok: boolean): void {
  if (ok) { pass++; console.log(`  PASS ${name}`) }
  else { fail++; console.log(`  FAIL ${name}`) }
}

check('1.0.0 < 1.1.0', compareVersion('1.0.0', '1.1.0') < 0)
check('1.10.0 > 1.9.0（不能用字串比）', compareVersion('1.10.0', '1.9.0') > 0)
check('1.1 == 1.1.0', compareVersion('1.1', '1.1.0') === 0)
check('2.0.0 > 1.99.99', compareVersion('2.0.0', '1.99.99') > 0)
check('沒回報版本（1.0.0 舊版）→ 太舊', agentOutdated(undefined))
check('空字串 → 太舊', agentOutdated(''))
check('1.0.0 → 太舊', agentOutdated('1.0.0', '1.1.0'))
check('剛好等於最低版 → 不舊', !agentOutdated('1.1.0', '1.1.0'))
check('比最低版新 → 不舊', !agentOutdated('1.2.0', '1.1.0'))
check('這一版 agent 本身不會被自己判為太舊', !agentOutdated(AGENT_VERSION, MIN_AGENT_VERSION))

console.log(`\n結果: ${pass} 通過 / ${fail} 失敗\n`)
process.exit(fail > 0 ? 1 : 0)
