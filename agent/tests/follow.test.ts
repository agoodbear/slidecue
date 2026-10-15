import { Align2 } from '../src/follow/align2.ts'
import { NoiseFloor, rms, LEGACY_RMS_THRESHOLD } from '../src/follow/vad.ts'
import { isNonSpeech, isLoop, isPromptEcho } from '../src/follow/filter.ts'
import { buildLocalPrompt, cleanLine, PROMPT_MAX_CHARS } from '../src/follow/prompt.ts'
import { pinyinOf, termsOf, localDice } from '../src/follow/text.ts'
import { bigrams } from '../../glasses/src/align.ts'
import { FollowPipeline } from '../src/follow/pipeline.ts'
import { setWhisperEndpoint } from '../src/listen.ts'

let pass = 0, fail = 0
function check(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  PASS ${name}`) }
  else { fail++; console.log(`  FAIL ${name} ${detail}`) }
}

/** 與 glasses/tests/align.test.ts 同一份講稿。 */
const LINES = [
  '各位早安，今天要談的是急診常見的心電圖陷阱。',      // 0
  '第一個重點是不要只看 ST 段，要看整體型態。',          // 1
  '這位病人到院時血壓偏低，心跳一百四十。',              // 2
  '心電圖顯示寬 QRS 頻脈，這時候第一個要排除的',        // 3
  '是心室頻脈，不要急著給腺苷。',                        // 4
  '如果血行動力不穩定，就直接電擊。',                    // 5
]

console.log('\n[1] 拼音與詞項')
check('拼音表：心電圖', [...'心電圖'].map(pinyinOf).join(' ') === 'xin dian tu', [...'心電圖'].map(pinyinOf).join(' '))
check('簡繁同拼音：電／电', pinyinOf('電') === pinyinOf('电'))
check('英數 token 整個算一項', termsOf('寬qrs頻脈').has('L:qrs'))
check('同音錯字的拼音 bigram 相同', [...termsOf('馬拉帕提')].every(t => termsOf('麻辣怕題').has(t)))
check('局部 dice 不被長行稀釋', localDice(bigrams('血壓偏低'), '這位病人到院時血壓偏低心跳一百四十再加三十個字充長度充長度充長度充長度充長度充長度', 6) >= 0.7, String(localDice(bigrams('血壓偏低'), '這位病人到院時血壓偏低心跳一百四十再加三十個字充長度充長度充長度充長度充長度充長度', 6)))

console.log('\n[2] 底噪閘門')
{
  const nf = new NoiseFloor()
  check('暖機前沿用固定門檻', nf.floor() === null && nf.isSpeech(LEGACY_RMS_THRESHOLD + 1) && !nf.isSpeech(LEGACY_RMS_THRESHOLD - 1))
  const noise = (amp: number) => { const b = Buffer.alloc(1600); for (let i = 0; i < 800; i++) b.writeInt16LE(Math.round(amp * Math.sin(i * 0.7)), i * 2); return b }
  for (let i = 0; i < 100; i++) nf.push(noise(1400))   // 底噪 RMS≈1000（G2 實測）
  const f = nf.floor()!
  check('底噪估計約 1000', f > 900 && f < 1100, String(f))
  check('只比底噪高一點不算講話', !nf.isSpeech(1100))
  check('底噪 1.3 倍以上算講話', nf.isSpeech(1400))
  const quiet = new NoiseFloor()
  for (let i = 0; i < 100; i++) quiet.push(noise(0))
  check('靜音檔有絕對下限 300', !quiet.isSpeech(250) && quiet.isSpeech(350))
  check('rms 計算', Math.abs(rms(noise(1400)) - 990) < 30, String(rms(noise(1400))))
}

console.log('\n[3] 非語音過濾')
check('括號類', isNonSpeech('(笑)') && isNonSpeech('( ˘ω˘ )') && isNonSpeech('【補充】') && isNonSpeech('(字幕:J Chong)'))
check('只有標點', isNonSpeech('。') && isNonSpeech('**'))
check('解碼迴圈', isLoop('肥肚的肥肚的肥肚的肥肚的') && isNonSpeech('肥肚的肥肚的肥肚的肥肚的肥肚的肥肚。'))
check('正常句子不過濾', !isNonSpeech('這位病人到院時血壓偏低') && !isNonSpeech('OK,謝謝') && !isNonSpeech('第六頸椎'))
check('短重複不算迴圈', !isLoop('哈哈') && !isLoop('一個一個排除'))
const prompt = LINES.slice(1, 4).join('')
check('補回：逐字等於 prompt 且能量貼底噪', isPromptEcho('第一個重點是不要只看ST段', prompt, 1100, 1000))
check('有能量就不算補回', !isPromptEcho('第一個重點是不要只看ST段', prompt, 2500, 1000))
check('太短不算補回', !isPromptEcho('第一個重點', prompt, 1100, 1000))
check('不在 prompt 裡不算補回', !isPromptEcho('今天天氣很好我們來講別的', prompt, 1100, 1000))

console.log('\n[4] 局部 prompt')
{
  const p = buildLocalPrompt(LINES, 2)
  check('含目前行與後兩行', p.includes('血壓偏低') && p.includes('QRS') && p.includes('腺苷'))
  check('含前一行', p.includes('整體型態'))
  check('不含更遠的行', !p.includes('電擊') && !p.includes('各位早安'))
  check('長度上限', [...buildLocalPrompt(LINES.map(l => l.repeat(4)), 2)].length <= PROMPT_MAX_CHARS)
  const long = LINES.map(l => l.repeat(4))
  check('超長時先丟前文、保住目前行', buildLocalPrompt(long, 2).startsWith(cleanLine(long[2]).slice(0, 10)))
  check('拿掉排版記號', !buildLocalPrompt(['**大字**〔原話〕第一句', '◆ 大字：第二句'], 0).includes('*'))
  check('標題與補充段不進 prompt', !buildLocalPrompt(['台詞一', '【補充】', '• 不用念'], 0).includes('不用念'))
  check('箭頭在不可念行時取下一可念行', buildLocalPrompt(['台詞一', '', '台詞二'], 1).includes('台詞二'))
}

console.log('\n[5] 對齊器 v2')
{
  const a = new Align2(LINES)
  let r = a.feed('這位病人到院時血壓偏低心跳一百四十', 1.2)
  check('精確念稿：對到第 2 行', r.cursor === 2 && r.kind === 'near', JSON.stringify(r))
  r = a.feed('心電圖顯示寬 QS 頻脈這時候第一個要排除的', 2.4)
  check('錯字不影響：第 3 行', r.cursor === 3, JSON.stringify(r))
  r = a.feed('是心室頻脈不要急著給線甘', 3.6)
  check('同音錯字：第 4 行', r.cursor === 4, JSON.stringify(r))
}
{
  const a = new Align2(LINES)
  const r = a.feed('這邊我想補充一個題外話跟大家分享', 1.2)
  check('離題時不動', r.cursor === 0 && !r.moved, JSON.stringify(r))
}
{
  const a = new Align2(LINES)
  a.setCursor(4)
  const r = a.feed('各位早安今天要談的是急診常見的', 1.2)
  check('跳回第 0 行（視野外、信心夠）', r.cursor === 0 && r.kind === 'jump', JSON.stringify(r))
  const weak = new Align2(LINES); weak.setCursor(5)
  const w = weak.feed('心電圖', 1.2)
  check('只有共用詞不跳', !w.moved, JSON.stringify(w))
}
{
  // 跳字念法：只念關鍵字也要跟得上
  const a = new Align2(LINES)
  a.feed('血壓偏低心跳一百四十', 1.2)
  const r = a.feed('QRS 頻脈 排除 心室頻脈', 2.4)
  check('只念關鍵字：往前到第 3 或 4 行', r.cursor === 3 || r.cursor === 4, JSON.stringify(r))
}
{
  const dup = ['這位病人心電圖顯示正常。', '接下來看第二位病人。', '這位病人心電圖顯示異常。']
  const a = new Align2(dup); a.setCursor(2)
  const r = a.feed('這位病人心電圖顯示', 1.2)
  check('重複詞兩行一樣像時不跳回前面', r.cursor === 2, JSON.stringify(r))
}
{
  // 跨輪累積：兩輪弱證據加起來能移動
  const a = new Align2(LINES)
  const r1 = a.feed('急著給', 1.2)
  const r2 = a.feed('急著給腺苷', 2.4)
  check('跨輪累積後移動', r2.cursor === 4, JSON.stringify([r1, r2]))
}
{
  const a = new Align2(['【標題】', '', '── 台上講 ──', '台詞一句話在這裡', '台詞第二句在這裡', '── 補充 ──', '補充不念'])
  const r = a.feed('台詞第二句在這裡', 1.2)
  check('結構版講稿：只在可念行之間移動', r.cursor === 4, JSON.stringify(r))
  check('空講稿不炸', new Align2([]).feed('隨便', 1).cursor === 0)
}

console.log('\n[5b] 手勢推到不可念行（審查第 1 項）')
{
  const L2 = ['台詞一句話在這裡', '台詞第二句在這裡', '台詞第三句在這裡', '【補充】', '• 不用念的補充一', '• 不用念的補充二']
  const a = new Align2(L2)
  a.setCursor(4)                                   // 推到【補充】以下
  check('推到補充行：對齊器錨在最後可念行', a.cursor === 2, String(a.cursor))
  let r = a.feed('台詞第三句在這裡', 1.2)
  check('推到補充行後開口：不回第 0 行', r.cursor === 2 && !r.moved, JSON.stringify(r))
  const b = new Align2(L2)
  b.setCursor(5)                                   // 推到最後一行（超過最後可念行）
  r = b.feed('不用念的補充', 1.2)
  check('推到末行之後開口：不回第 0 行', r.cursor === 2, JSON.stringify(r))
  const c = new Align2(['【① 轉換】標題', '', '── 台上講 ──', '台詞一', '台詞二'])
  c.setCursor(0)                                   // 推到開頭的標題：前面沒有可念行 → 維持原位
  check('推到開頭標題：維持原位', c.cursor === 3, String(c.cursor))
  check('空講稿 setCursor 不炸', (() => { const e = new Align2([]); e.setCursor(3); return e.cursor === 0 })())
}

console.log('\n[6] 管線（假 whisper）')
{
  // 假 whisper：用 heard 佇列回應，不開真的 server
  const queue: string[] = []
  const fakeServer = await import('node:http').then(http => http.createServer((_, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ text: queue.shift() ?? '' }))
  }))
  await new Promise<void>(r => fakeServer.listen(0, '127.0.0.1', () => r()))
  const port = (fakeServer.address() as { port: number }).port
  setWhisperEndpoint(`http://127.0.0.1:${port}`)
  const speech = (amp: number, n: number) => { const b = Buffer.alloc(n * 2); for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(amp * Math.sin(i * 0.3)), i * 2); return b }

  for (const v2 of [true, false]) {
    const fp = new FollowPipeline({ v2, simulateBusy: true })
    fp.setLines(LINES)
    check(`v${v2 ? 2 : 1}：換張後箭頭在第 0 行`, fp.cursor === 0)
    // 2.5 秒底噪（讓底噪估計暖機）→ 視窗 1 安靜
    let ev = null
    for (let i = 0; i < 50; i++) ev = await fp.onPcm(speech(1400, 800)) ?? ev
    check(`v${v2 ? 2 : 1}：純底噪視窗${v2 ? '判為安靜' : '（舊版 RMS>500 會送辨識）'}`, v2 ? ev?.kind === 'quiet' : ev?.kind !== 'quiet', JSON.stringify(ev))
    queue.push(v2 ? '(笑)' : '', '這位病人到院時血壓偏低心跳一百四十', '是心室頻脈不要急著給腺苷')
    const evs: string[] = []
    for (let i = 0; i < 24 * 3; i++) { const e = await fp.onPcm(speech(6000, 800)); if (e) evs.push(e.kind) }
    check(`v${v2 ? 2 : 1}：事件序列合理`, evs.length === 3 && evs[1] === 'move' && evs[2] === 'move', JSON.stringify(evs))
    check(`v${v2 ? 2 : 1}：箭頭到第 4 行`, fp.cursor === 4, String(fp.cursor))
    fp.setCursor(1)
    check(`v${v2 ? 2 : 1}：手勢推箭頭`, fp.cursor === 1)
    if (v2) {
      const L2 = ['台詞一句話在這裡', '台詞第二句在這裡', '台詞第三句在這裡', '【補充】', '• 不用念的補充一']
      fp.setLines(L2)
      for (let i = 0; i < 50; i++) await fp.onPcm(speech(1400, 800))
      fp.setCursor(4)                                // 手勢推到補充行
      queue.push('台詞第三句在這裡', '台詞第三句在這裡', '台詞第三句在這裡')
      const got: string[] = []
      for (let i = 0; i < 24 * 3; i++) { const e = await fp.onPcm(speech(6000, 800)); if (e && e.kind !== 'quiet') got.push(e.kind) }
      check('推到補充行後開口：沒有拉回第 0 行的 move', got.includes('stay') && !got.includes('move') && fp.cursor === 4, JSON.stringify(got) + ' cursor=' + fp.cursor)
      // 換頁後回來的結果要丟掉：先推一個視窗進辨識，在 await 期間 setLines
      queue.push('台詞第二句在這裡')
      let pending: Promise<any> | null = null
      for (let i = 0; i < 24 * 2 && !pending; i++) { const pr = fp.onPcm(speech(6000, 800)); const e = await Promise.race([pr, new Promise(r => setTimeout(() => r('busy'), 0))]); if (e === 'busy') pending = pr }
      if (pending) { fp.setLines(LINES); const e = await pending; check('辨識期間換頁：結果標 stale、箭頭留在新張第 0 行', e?.kind === 'stale' && fp.cursor === 0, JSON.stringify(e)) }
      else check('辨識期間換頁（無法重現 busy，略過）', true)
    }
  }
  fakeServer.close()
  setWhisperEndpoint(null)
}

console.log(`\n結果: ${pass} 通過 / ${fail} 失敗\n`)
process.exit(fail > 0 ? 1 : 0)
