import { getTextWidth } from '@evenrealities/pretext'
import { clockNow, duration, countdown, nowCell, elapsedCell, countdownCell } from '../src/clock.ts'

let pass = 0, fail = 0
function check(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  PASS ${name}`) }
  else { fail++; console.log(`  FAIL ${name} ${detail}`) }
}

const at = (h: number, m: number) => new Date(2026, 7, 20, h, m, 0)

import { NOW_TEXT_W as NOW_W, ELAPSED_TEXT_W as ELAPSED_W, COUNTDOWN_TEXT_W as COUNTDOWN_W } from '../src/ui.ts'

console.log('\n[1] 時鐘')
check('補零', clockNow(at(9, 5)) === '09:05', clockNow(at(9, 5)))
check('24 小時制', clockNow(at(14, 35)) === '14:35', clockNow(at(14, 35)))
check('午夜', clockNow(at(0, 0)) === '00:00', clockNow(at(0, 0)))

console.log('\n[2] 時長格式')
check('未滿一分', duration(42) === '0:42', duration(42))
check('分秒補零', duration(8 * 60 + 5) === '8:05', duration(485))
check('滿一小時才顯示小時', duration(3600) === '1:00:00', duration(3600))
check('負數視為 0', duration(-5) === '0:00', duration(-5))

console.log('\n[3] 每段時間都有中文標籤')
{
  check('現在欄', nowCell(at(14, 35)) === '現在 14:35', nowCell(at(14, 35)))
  check('授課欄只到分鐘', elapsedCell(522) === '授課 8 分', elapsedCell(522))
  check('倒數欄只到分鐘', countdownCell(522, 30, COUNTDOWN_W) === '下課倒數 21 分',
    countdownCell(522, 30, COUNTDOWN_W))
  const all = nowCell(at(14, 35)) + elapsedCell(522) + countdownCell(522, 30, COUNTDOWN_W)
  check('沒有留下難懂的符號', !/[▶▽▼▲]/.test(all), all)
}

console.log('\n[4] 倒數各階段')
check('不設定時長就不顯示倒數', countdown(100, 0) === '')
check('30 分鐘講了 8 分餘，剩 21 分', countdown(522, 30) === '下課倒數 21 分', countdown(522, 30))
{
  const warn = countdown(30 * 60 - 240, 30)
  check('剩五分鐘內出現進度條', warn.includes('▇') || warn.includes('▁'), warn)
  check('仍標著「下課倒數」', warn.startsWith('下課倒數'), warn)
  check('超時改標「已超時」', countdown(33 * 60 + 20, 30) === '已超時 3:20',
    countdown(33 * 60 + 20, 30))
}

console.log('\n[5] 進度條')
{
  const c5 = countdown(30 * 60 - 300, 30)
  const c1 = countdown(30 * 60 - 60, 30)
  const cells5 = (c5.match(/▇/g) ?? []).length
  const cells1 = (c1.match(/▇/g) ?? []).length
  check('剩越少亮格越少', cells1 < cells5, `剩5分=${cells5}格, 剩1分=${cells1}格`)
  check('總格數固定為 4', (c5.match(/[▇▁]/g) ?? []).length === 4,
    `實得 ${(c5.match(/[▇▁]/g) ?? []).length}`)
}

console.log('\n[6] 各欄都不爆版（含最長情況）')
{
  const cases: Array<[string, string, number]> = [
    ['現在 09:05',        nowCell(at(9, 5)), NOW_W],
    ['授課 2:15:30',      elapsedCell(8130), ELAPSED_W],
    ['倒數 一般',         countdownCell(522, 30, COUNTDOWN_W), COUNTDOWN_W],
    ['倒數 帶進度條',     countdownCell(30 * 60 - 272, 30, COUNTDOWN_W), COUNTDOWN_W],
    ['倒數 長演講',       countdownCell(60, 120, COUNTDOWN_W), COUNTDOWN_W],
    ['倒數 超時',         countdownCell(33 * 60 + 20, 30, COUNTDOWN_W), COUNTDOWN_W],
    ['倒數 超時很久',     countdownCell(200 * 60, 30, COUNTDOWN_W), COUNTDOWN_W],
  ]
  for (const [name, text, limit] of cases) {
    const w = getTextWidth(text)
    check(`${name} 不爆版`, w <= limit, `${w}px > ${limit}px ｜ ${text}`)
  }
}

console.log('\n[7] 倒數欄的降級順序')
{
  // 稍窄：應該先把標籤縮短，保住進度條
  const shortened = countdownCell(30 * 60 - 272, 30, 175)
  check('先縮標籤而不是先丟進度條', shortened.startsWith('倒數') &&
    (shortened.includes('▇') || shortened.includes('▁')), shortened)

  // 更窄：標籤縮了還不夠，才丟進度條
  const narrow = countdownCell(30 * 60 - 272, 30, 120)
  check('再窄才丟進度條', !narrow.includes('▇') && !narrow.includes('▁'), narrow)
  check('但保留標籤與數字', narrow.includes('倒數') && /\d/.test(narrow), narrow)

  // 再窄到連標籤都放不下
  const tiny = countdownCell(30 * 60 - 272, 30, 60)
  check('極窄時只留時間數字', /^\d/.test(tiny), tiny)
}

console.log('\n[8] 只用字型支援的字元（emoji 會被靜默跳過）')
{
  const all = nowCell(at(14, 35)) + elapsedCell(100) +
    countdownCell(30 * 60 - 60, 30, COUNTDOWN_W) + countdown(9999, 30)
  const allowed = /^[分0-9:\s▇▁現在授課下倒數已超時]*$/
  check('沒有混入未驗證的字元', allowed.test(all), all)
}

console.log('\n[8] 藍牙頻寬：時間欄平常不可以每秒都變')
{
  // 每一次時間欄更新都是一趟藍牙重繪（實測授課 234ms、倒數 378ms）。
  // 若每秒都變，兩者就吃掉每秒 612ms，講者滑動時箭頭搶不到頻寬，
  // 實機上表現為整段講稿劇烈抖動。這一組測試把「不准每秒變」釘住。
  const D = 120

  // 掃一整段時間，數它到底更新幾次。單點比較會選到跨小時的邊界
  // （1:00 → 59 分 是正常的每小時一次），統計才看得出真實負載。
  const countChanges = (fn: (t: number) => string, from: number, to: number): number => {
    let n = 0
    for (let t = from; t < to; t++) if (fn(t) !== fn(t + 1)) n++
    return n
  }

  const SPAN = 600   // 十分鐘
  const elapsedChanges = countChanges(elapsedCell, 600, 600 + SPAN)
  check(`授課欄十分鐘內只更新 ${elapsedChanges} 次（顯示到秒的話會是 ${SPAN} 次）`,
    elapsedChanges <= 11)

  // 取一段離「最後五分鐘」還很遠的區間
  const cdChanges = countChanges(t => countdownCell(t, D, COUNTDOWN_W), 600, 600 + SPAN)
  check(`倒數欄十分鐘內只更新 ${cdChanges} 次（顯示到秒的話會是 ${SPAN} 次）`,
    cdChanges <= 11)

  // 但最後五分鐘要精確到秒——那時候秒數才真的有意義
  const nearEnd = D * 60 - 200          // 剩 3 分 20 秒
  check('最後五分鐘：倒數欄逐秒更新',
    countdownCell(nearEnd, D, COUNTDOWN_W) !== countdownCell(nearEnd + 1, D, COUNTDOWN_W))
  check('超時後也逐秒更新',
    countdownCell(D * 60 + 5, D, COUNTDOWN_W) !== countdownCell(D * 60 + 6, D, COUNTDOWN_W))
}

console.log(`\n結果: ${pass} 通過 / ${fail} 失敗\n`)
process.exit(fail > 0 ? 1 : 0)
