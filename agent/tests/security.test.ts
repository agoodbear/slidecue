/**
 * 外部輸入的防線：AppleScript 字串逸出、控制訊息驗證、HTML 逸出。
 *
 * 這幾支擋的是「手機端（或同網段的任何人）送來的字串」跑進 osascript 原始碼、
 * WAV 表頭或狀態頁 HTML。沒有 macOS 也能跑：只驗字串層面的不變量。
 */
import { asString } from '../src/applescript.ts'
import { parseControl, isKnownDeck, escapeHtml, STATS_MAX_CHARS, LINES_MAX } from '../src/control.ts'

let pass = 0, fail = 0
function check(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  PASS ${name}`) }
  else { fail++; console.log(`  FAIL ${name} ${detail}`) }
}

/**
 * AppleScript 字串字面值的文法：`"` 開頭結尾，中間只能是「非 " 非 \ 的字元」或「\ 加任一字元」。
 * 整段吻合就代表輸出是**單一個**字串字面值，不可能在中途關掉字串、接出程式碼。
 */
const SINGLE_LITERAL = /^"(?:[^"\\]|\\[\s\S])*"$/

/** 依 AppleScript 規則把字面值解回原字串，用來確認逸出沒有改到內容。 */
function unquote(lit: string): string {
  return lit.slice(1, -1).replace(/\\([\s\S])/g, '$1')
}

console.log('\n[1] AppleScript 字串逸出')
{
  const cases = [
    '期末報告.key',
    '他說"你好"',
    'C:\\path\\deck',
    '尾端反斜線\\',
    // 舊版只逸出 " 時可以跳出字串的 payload：\" 會變 \\" → 反斜線被吃掉、引號把字串關掉
    '\\" & (do shell script "id") --',
    '\\\\" & (do shell script "id") & "',
    '多行\n第二行',
    '',
  ]
  for (const c of cases) {
    const lit = asString(c)
    check(`單一字面值：${JSON.stringify(c)}`, SINGLE_LITERAL.test(lit), lit)
    check(`內容不變：${JSON.stringify(c)}`, unquote(lit) === c, unquote(lit))
  }
  // 對照：舊寫法確實會被打穿（留著這條，避免有人把 asString 改回只換引號）
  const legacy = (s: string) => `"${s.replace(/"/g, '\\"')}"`
  check('舊寫法對 payload 不是單一字面值（回歸對照）', !SINGLE_LITERAL.test(legacy('\\" & (do shell script "id") --')))
}

console.log('\n[2] parseControl：合法訊息原樣通過')
{
  const ok: unknown[] = [
    { type: 'control', action: 'next' },
    { type: 'control', action: 'prev' },
    { type: 'control', action: 'resync' },
    { type: 'control', action: 'resetTimer' },
    { type: 'mode', mode: 'ring' },
    { type: 'mode', mode: 'manual' },
    { type: 'lines', slide: 3, lines: ['第一行', '第二行'] },
    { type: 'audio', pcm: 'AAAA' },
    { type: 'audio', pcm: 'AAAA', sampleRate: 16000 },
    { type: 'follow', on: true },
    { type: 'follow', on: false },
    { type: 'cursorAt', line: 0 },
    { type: 'stats', text: '[v1.24.4] 已連線' },
    { type: 'pickDeck', name: '期末報告' },
    { type: 'pickDeck', name: null },
  ]
  for (const m of ok) {
    const r = parseControl(m)
    check(`通過：${JSON.stringify(m)}`, JSON.stringify(r) === JSON.stringify(m), JSON.stringify(r))
  }
}

console.log('\n[3] parseControl：不合格一律丟掉')
{
  const bad: unknown[] = [
    null, 42, 'next', [], {},
    { type: 'nope' },
    { type: 'control', action: 'rm -rf' },
    { type: 'mode', mode: 'admin' },
    { type: 'lines', lines: 'abc' },
    { type: 'lines', lines: ['ok', 3] },
    { type: 'lines', lines: new Array(LINES_MAX + 1).fill('x') },
    { type: 'audio' },                                    // 舊版：Buffer.from(undefined) 在 try 外丟錯
    { type: 'audio', pcm: 123 },
    { type: 'audio', pcm: 'AAAA', sampleRate: 'abc' },    // 舊版：寫進全域取樣率，WAV 表頭整場壞掉
    { type: 'audio', pcm: 'AAAA', sampleRate: 0 },
    { type: 'audio', pcm: 'AAAA', sampleRate: -16000 },
    { type: 'audio', pcm: 'AAAA', sampleRate: 16000.5 },
    { type: 'audio', pcm: 'AAAA', sampleRate: 1e12 },
    { type: 'follow', on: 'yes' },
    { type: 'cursorAt', line: -1 },
    { type: 'cursorAt', line: '2' },
    { type: 'cursorAt', line: 1.5 },
    { type: 'stats', text: { a: 1 } },
    { type: 'pickDeck', name: 7 },
    { type: 'pickDeck' },
  ]
  for (const m of bad) {
    const shown = JSON.stringify(m)?.slice(0, 60)
    check(`丟掉：${shown}`, parseControl(m) === null)
  }
}

console.log('\n[4] parseControl：正規化')
{
  const extra = parseControl({ type: 'control', action: 'next', evil: 'x', __proto__: { y: 1 } })
  check('多餘欄位不會被帶進去', JSON.stringify(extra) === '{"type":"control","action":"next"}', JSON.stringify(extra))
  const s = parseControl({ type: 'stats', text: 'a\nb\r\n' + 'x'.repeat(STATS_MAX_CHARS * 2) })
  check('stats 去換行（擋偽造 log 行）', s?.type === 'stats' && !/[\r\n]/.test(s.text))
  check('stats 截長', s?.type === 'stats' && s.text.length === STATS_MAX_CHARS)
  const l = parseControl({ type: 'lines', lines: ['a'] })
  check('lines 缺 slide 補 0', l?.type === 'lines' && l.slide === 0)
}

console.log('\n[5] pickDeck 白名單')
{
  const docs = [{ name: '主簡報' }, { name: '備用' }]
  check('null（回自動）一律允許', isKnownDeck(null, docs))
  check('清單內的名稱允許', isKnownDeck('備用', docs))
  check('清單外的名稱拒絕', !isKnownDeck('\\" & (do shell script "id") --', docs))
  check('沒有開任何簡報時只允許 null', !isKnownDeck('主簡報', []) && isKnownDeck(null, []))
}

console.log('\n[6] HTML 逸出')
{
  check('角括號與 & 逸出', escapeHtml('<img src=x onerror=alert(1)>&') === '&lt;img src=x onerror=alert(1)&gt;&amp;')
  check('引號逸出', escapeHtml(`"'`) === '&quot;&#39;')
  check('中文原樣', escapeHtml('期末報告') === '期末報告')
}

console.log(`\n結果: ${pass} 通過 / ${fail} 失敗\n`)
process.exit(fail > 0 ? 1 : 0)
