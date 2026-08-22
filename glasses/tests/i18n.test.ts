import { setLang, getLang, detectLang, t, type Lang } from '../src/i18n.ts'
import { nowCell, elapsedCell, countdownCell } from '../src/clock.ts'
import { getTextWidth } from '@evenrealities/pretext'

let pass = 0, fail = 0
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) { pass++; console.log(`  PASS ${name}`) }
  else { fail++; console.log(`  FAIL ${name} ${detail}`) }
}

const LANGS: Lang[] = ['zh', 'en']
// ui.ts 實測的欄寬
const NOW_W = 116, ELAPSED_W = 126, COUNTDOWN_W = 196

console.log('\n[1] 兩種語言都不能爆版')
{
  for (const lang of LANGS) {
    setLang(lang)
    const cases: Array<[string, string, number]> = [
      ['現在欄', nowCell(new Date(2026, 7, 22, 23, 59)), NOW_W],
      ['授課欄（破 1 小時）', elapsedCell(7 * 3600 + 59 * 60), ELAPSED_W],
      ['倒數 一般', countdownCell(3725, 180, COUNTDOWN_W), COUNTDOWN_W],
      ['倒數 帶進度條', countdownCell(180 * 60 - 272, 180, COUNTDOWN_W), COUNTDOWN_W],
      ['倒數 超時很久', countdownCell(180 * 60 + 9999, 180, COUNTDOWN_W), COUNTDOWN_W],
    ]
    for (const [label, text, limit] of cases) {
      const w = getTextWidth(text)
      check(`[${lang}] ${label} 不爆版（${w}/${limit}px）`, w <= limit, text)
    }
  }
}

console.log('\n[2] 最後五分鐘的進度條，兩種語言都要在')
{
  // 這是實際踩過的 bug：降級邏輯寫死中文標籤，英文對不上就跳過縮短，
  // 直接把進度條丟了——而那條逐格熄滅的進度條正是最後五分鐘最有用的東西。
  for (const lang of LANGS) {
    setLang(lang)
    const txt = countdownCell(120 * 60 - 272, 120, COUNTDOWN_W)
    check(`[${lang}] 最後五分鐘有進度條`, /[▇▁]/.test(txt), txt)
    check(`[${lang}] 而且沒爆版`, getTextWidth(txt) <= COUNTDOWN_W, txt)
  }
}

console.log('\n[3] 鏡片字串不可以留下另一種語言')
{
  setLang('en')
  const enText = [nowCell(), elapsedCell(3725), countdownCell(3725, 120, COUNTDOWN_W),
                  countdownCell(120*60-100, 120, COUNTDOWN_W), t().lensNoScript].join(' ')
  check('英文介面不含中文字', !/[一-鿿]/.test(enText), enText)

  setLang('zh')
  const zhText = nowCell() + elapsedCell(3725) + countdownCell(3725, 120, COUNTDOWN_W)
  check('中文介面含中文字', /[一-鿿]/.test(zhText), zhText)
}

console.log('\n[4] 語言偵測與切換')
{
  check('setLang/getLang 一致', (setLang('en'), getLang() === 'en'))
  check('切回中文', (setLang('zh'), getLang() === 'zh'))
  check('detectLang 回傳合法值', LANGS.includes(detectLang()))
  setLang('en'); const a = t().secCode
  setLang('zh'); const b = t().secCode
  check('切換語言後 t() 立刻反映', a !== b, `${a} / ${b}`)
}

console.log('\n[5] 兩種語言的字串表結構一致')
{
  setLang('zh'); const zhKeys = Object.keys(t()).sort()
  setLang('en'); const enKeys = Object.keys(t()).sort()
  check(`欄位數相同（${zhKeys.length}）`, zhKeys.length === enKeys.length)
  check('欄位名完全一致', JSON.stringify(zhKeys) === JSON.stringify(enKeys),
    zhKeys.filter(k => !enKeys.includes(k)).join(','))
  // 沒有漏翻的（值不該兩種語言完全一樣，除非本來就是符號）
  setLang('zh'); const zhVals = t()
  setLang('en'); const enVals = t()
  const same = zhKeys.filter(k => {
    const a = (zhVals as Record<string, unknown>)[k]
    const b = (enVals as Record<string, unknown>)[k]
    return typeof a === 'string' && a === b
  })
  check(`沒有漏翻的字串${same.length ? '：' + same.join(',') : ''}`, same.length === 0)
}

console.log(`\n結果: ${pass} 通過 / ${fail} 失敗\n`)
process.exit(fail > 0 ? 1 : 0)
