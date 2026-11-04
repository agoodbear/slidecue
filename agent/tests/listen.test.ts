/**
 * listen.ts 的純函式：滑動視窗、WAV 表頭、固定門檻的有聲判斷。
 * 這三支先前沒有直接測試，只靠 follow.test.ts 間接帶到。
 */
import { AudioWindow, pcmToWav, hasSpeech } from '../src/listen.ts'

let pass = 0, fail = 0
function check(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  PASS ${name}`) }
  else { fail++; console.log(`  FAIL ${name} ${detail}`) }
}

const WINDOW_BYTES = 2.5 * 16000 * 2   // 80000
const STEP_BYTES = 1.2 * 16000 * 2     // 38400

console.log('\n[1] AudioWindow')
{
  const w = new AudioWindow()
  check('不滿一個視窗回 null', w.push(Buffer.alloc(WINDOW_BYTES - 2)) === null)
  check('pending 累積', w.pending === WINDOW_BYTES - 2)
  const win = w.push(Buffer.alloc(2))
  check('剛好滿一個視窗就吐出', win !== null && win.length === WINDOW_BYTES, String(win?.length))
  check('吐出後保留重疊區（視窗 − 步長）', w.pending === WINDOW_BYTES - STEP_BYTES, String(w.pending))
  check('再補一個步長又滿', w.push(Buffer.alloc(STEP_BYTES - 1)) === null && w.push(Buffer.alloc(1))?.length === WINDOW_BYTES)
  w.reset()
  check('reset 清空', w.pending === 0)
}
{
  // 視窗內容必須是「最新的」那段聲音，不能是最舊的
  const w = new AudioWindow()
  const big = Buffer.alloc(WINDOW_BYTES * 2)
  big.writeUInt8(0xab, big.length - 1)
  const win = w.push(big)!
  check('一次塞超過一個視窗：取最後那段', win.length === WINDOW_BYTES && win[win.length - 1] === 0xab)
  check('緩衝不會無限長大', w.pending === WINDOW_BYTES - STEP_BYTES, String(w.pending))
  win[0] = 0x11
  check('回傳的是複本，改它不影響內部緩衝', w.push(Buffer.alloc(0)) === null)
}

console.log('\n[2] pcmToWav')
{
  const pcm = Buffer.alloc(320)
  const wav = pcmToWav(pcm, 16000)
  check('總長 = 44 + PCM', wav.length === 364)
  check('RIFF/WAVE/fmt/data 標記', wav.toString('ascii', 0, 4) === 'RIFF' && wav.toString('ascii', 8, 12) === 'WAVE' &&
        wav.toString('ascii', 12, 16) === 'fmt ' && wav.toString('ascii', 36, 40) === 'data')
  check('RIFF 長度 = 36 + PCM', wav.readUInt32LE(4) === 356)
  check('PCM、單聲道', wav.readUInt16LE(20) === 1 && wav.readUInt16LE(22) === 1)
  check('取樣率與位元率', wav.readUInt32LE(24) === 16000 && wav.readUInt32LE(28) === 32000)
  check('block align 2、16 bit', wav.readUInt16LE(32) === 2 && wav.readUInt16LE(34) === 16)
  check('data 長度', wav.readUInt32LE(40) === 320)
  check('其他取樣率照寫', pcmToWav(pcm, 48000).readUInt32LE(24) === 48000)
}

console.log('\n[3] hasSpeech（舊版固定門檻 500）')
{
  const tone = (amp: number) => { const b = Buffer.alloc(3200); for (let i = 0; i < 1600; i++) b.writeInt16LE(i % 2 ? amp : -amp, i * 2); return b }
  check('空的不算', !hasSpeech(Buffer.alloc(0)))
  check('單一位元組不算', !hasSpeech(Buffer.alloc(1)))
  check('全靜音不算', !hasSpeech(Buffer.alloc(3200)))
  check('RMS 剛好 500 不算（嚴格大於）', !hasSpeech(tone(500)))
  check('RMS 501 算', hasSpeech(tone(501)))
  check('自訂門檻', !hasSpeech(tone(1000), 1000) && hasSpeech(tone(1001), 1000))
}

console.log(`\n結果: ${pass} 通過 / ${fail} 失敗\n`)
process.exit(fail > 0 ? 1 : 0)
