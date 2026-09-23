import { alignToLine, normalize, bigrams, dice, speakableLines } from '../src/align.ts'

let pass = 0, fail = 0
function check(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  PASS ${name}`) }
  else { fail++; console.log(`  FAIL ${name} ${detail}`) }
}

/** 一份貼近實際的講稿，已斷好行。 */
const LINES = [
  '各位早安，今天要談的是急診常見的心電圖陷阱。',      // 0
  '第一個重點是不要只看 ST 段，要看整體型態。',          // 1
  '這位病人到院時血壓偏低，心跳一百四十。',              // 2
  '心電圖顯示寬 QRS 頻脈，這時候第一個要排除的',        // 3
  '是心室頻脈，不要急著給腺苷。',                        // 4
  '如果血行動力不穩定，就直接電擊。',                    // 5
]

console.log('\n[1] 基礎工具')
check('正規化去掉標點與空白', normalize('心電圖，顯示 寬 QRS！') === '心電圖顯示寬qrs',
  normalize('心電圖，顯示 寬 QRS！'))
check('bigram 數量正確', bigrams('心電圖').size === 2)
check('完全相同得分 1', dice(bigrams('心室頻脈'), bigrams('心室頻脈')) === 1)
check('完全不同得分 0', dice(bigrams('心室頻脈'), bigrams('血壓偏低')) === 0)

console.log('\n[2] 精確念稿')
{
  const r = alignToLine('這位病人到院時血壓偏低心跳一百四十', LINES, 2)
  check('對到第 2 行', r.line === 2, `得到 ${r.line} (score ${r.score.toFixed(2)})`)
  check('分數很高', r.score > 0.8, r.score.toFixed(2))
}

console.log('\n[3] 辨識有錯字仍能對上')
{
  // whisper 常見錯誤：QRS 聽成 QS、腺苷聽成線甘
  const r = alignToLine('心電圖顯示寬 QS 頻脈這時候第一個要排除的', LINES, 3)
  check('錯字不影響定位', r.line === 3, `得到 ${r.line} (score ${r.score.toFixed(2)})`)
}

console.log('\n[4] 講者漏字、即興改字')
{
  const r = alignToLine('血壓偏低心跳一百四', LINES, 2)
  check('漏字仍對到第 2 行', r.line === 2, `得到 ${r.line} (score ${r.score.toFixed(2)})`)
}

console.log('\n[5] 往前推進')
{
  // 箭頭在第 2 行，講者已經念到第 4 行的內容
  const r = alignToLine('是心室頻脈不要急著給腺苷', LINES, 2)
  check('能往前跳到第 4 行', r.line === 4, `得到 ${r.line} (score ${r.score.toFixed(2)})`)
}

console.log('\n[6] 絕不回頭')
{
  // 箭頭已在第 4 行，卻聽到第 0 行的內容（例如講者回頭補充）
  const r = alignToLine('各位早安今天要談的是急診常見的', LINES, 4)
  check('不會倒退回第 0 行', r.line !== 0, `得到 ${r.line}`)
  check('信心不足時回傳 -1', r.line === -1, `得到 ${r.line} (score ${r.score.toFixed(2)})`)
}

console.log('\n[7] 離題時維持原位')
{
  const r = alignToLine('這邊我想補充一個題外話跟大家分享', LINES, 2)
  check('完全不相關時回傳 -1', r.line === -1, `得到 ${r.line} (score ${r.score.toFixed(2)})`)
}

console.log('\n[8] 不會跳過太遠')
{
  // 箭頭在第 0 行，聽到第 5 行的內容（超出 lookahead=3）
  const r = alignToLine('如果血行動力不穩定就直接電擊', LINES, 0)
  check('超出視野範圍不亂跳', r.line !== 5, `得到 ${r.line}`)
}

console.log('\n[9] 邊界')
{
  check('空辨識結果回傳 -1', alignToLine('', LINES, 0).line === -1)
  check('單字太短回傳 -1', alignToLine('心', LINES, 0).line === -1)
  check('空講稿不炸', alignToLine('隨便念一句', [], 0).line === -1)
  const last = alignToLine('如果血行動力不穩定就直接電擊', LINES, 5)
  check('最後一行仍可匹配', last.line === 5, `得到 ${last.line}`)
}

console.log('\n[10] 重複詞不會誤判')
{
  const dup = [
    '這位病人心電圖顯示正常。',
    '接下來看第二位病人。',
    '這位病人心電圖顯示異常。',
  ]
  // 箭頭在第 2 行，聽到「這位病人心電圖顯示異常」應該留在第 2 行不倒退
  const r = alignToLine('這位病人心電圖顯示異常', dup, 2)
  check('對到正確的那一行', r.line === 2, `得到 ${r.line} (score ${r.score.toFixed(2)})`)
}

// 2026-09-23 回歸：講稿結構版備忘錄開頭有標題＋空行＋分隔線，
// 舊版 lookahead 只數實體行，箭頭停在第 0 行永遠看不到第一句台詞。
{
  const L = [
    '【① 轉換｜03:25　30 秒】為什麼留下來：看得到它在做什',
    '麼',
    '',
    '── 台上講 ──',
    '〔原話〕一開始我很習慣龍蝦的工作流，但後來真正跳到',
    'Claude Code 之後，又被它的工作流給吸引。',
    '',
    '── 補充（不用念，被問到再講） ──',
    '・前四句是你9/19的原話：投影片放原文',
  ]
  check('結構版：只收台上講區', JSON.stringify(speakableLines(L)) === '[4,5]')
  check('結構版：第 0 行就能對到第一句台詞', alignToLine('一開始我很習慣龍蝦的工作流', L, 0).line === 4)
  check('結構版：補充段不會被對到', alignToLine('前四句是你的原話投影片放原文', L, 5).line === -1)
  check('〔原話〕標記被正規化拿掉', normalize('〔原話〕你好') === '你好')
}

console.log(`\n結果: ${pass} 通過 / ${fail} 失敗\n`)
process.exit(fail > 0 ? 1 : 0)
