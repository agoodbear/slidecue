import { gestureOf, routeGesture, CLICK, SWIPE_UP, SWIPE_DOWN, DOUBLE_CLICK, LONG_PRESS, type GestureContext } from '../src/gestures.ts'

let pass = 0, fail = 0
function check(name: string, ok: boolean): void {
  if (ok) { pass++; console.log(`  PASS ${name}`) }
  else { fail++; console.log(`  FAIL ${name}`) }
}

// ── gestureOf：真機走 sysEvent、模擬器走 textEvent ──
const ev = (o: object) => o as Parameters<typeof gestureOf>[0]
check('真機單擊（protobuf 省略零值）→ 0', gestureOf(ev({ sysEvent: {} })) === CLICK)
check('模擬器單擊 → 0', gestureOf(ev({ textEvent: {} })) === CLICK)
check('真機上滑 → 1', gestureOf(ev({ sysEvent: { eventType: 1 } })) === SWIPE_UP)
check('模擬器下滑 → 2', gestureOf(ev({ textEvent: { eventType: 2 } })) === SWIPE_DOWN)
check('真機長按 → 9（不能被當成系統事件濾掉）', gestureOf(ev({ sysEvent: { eventType: 9 } })) === LONG_PRESS)
check('長按放開 10 → 忽略', gestureOf(ev({ sysEvent: { eventType: 10 } })) === null)
for (const sys of [4, 5, 6, 7, 8]) {
  check(`系統事件 ${sys} → 忽略`, gestureOf(ev({ sysEvent: { eventType: sys } })) === null)
}
check('沒有任何事件 → 忽略', gestureOf(ev({})) === null)

// ── routeGesture ──
const ctx = (o: Partial<GestureContext> = {}): GestureContext =>
  ({ live: true, mode: 'ring', cursorLine: 3, lineCount: 10, ...o })

check('雙擊一律離開（審核必檢）', routeGesture(DOUBLE_CLICK, ctx()) === 'exit')
check('雙擊離線也是離開', routeGesture(DOUBLE_CLICK, ctx({ live: false })) === 'exit')

check('戒指模式單擊 → Keynote 下一步', routeGesture(CLICK, ctx()) === 'sendNext')
check('自己翻模式單擊 → 箭頭下移', routeGesture(CLICK, ctx({ mode: 'manual' })) === 'cursorDown')
check('離線單擊、稿還沒念完 → 箭頭下移', routeGesture(CLICK, ctx({ live: false })) === 'cursorDown')
check('離線單擊、已在最後一行 → 快取下一張', routeGesture(CLICK, ctx({ live: false, cursorLine: 9 })) === 'localNext')

check('戒指模式長按 → Keynote 上一張', routeGesture(LONG_PRESS, ctx()) === 'sendPrev')
check('自己翻模式長按 → 不動作（Keynote 當家）', routeGesture(LONG_PRESS, ctx({ mode: 'manual' })) === 'none')
check('離線長按 → 快取上一張', routeGesture(LONG_PRESS, ctx({ live: false })) === 'localPrev')

check('上滑、不在第一行 → 箭頭上移', routeGesture(SWIPE_UP, ctx()) === 'cursorUp')
check('上滑、已在第一行、戒指模式 → Keynote 上一張', routeGesture(SWIPE_UP, ctx({ cursorLine: 0 })) === 'sendPrev')
check('上滑、已在第一行、自己翻模式 → 不動作', routeGesture(SWIPE_UP, ctx({ cursorLine: 0, mode: 'manual' })) === 'none')
check('上滑、已在第一行、離線 → 快取上一張', routeGesture(SWIPE_UP, ctx({ cursorLine: 0, live: false })) === 'localPrev')
check('下滑 → 箭頭下移（不翻頁）', routeGesture(SWIPE_DOWN, ctx()) === 'cursorDown')

check('未知手勢 → 不動作', routeGesture(42, ctx()) === 'none')

console.log(`\n結果: ${pass} 通過 / ${fail} 失敗\n`)
process.exit(fail > 0 ? 1 : 0)
