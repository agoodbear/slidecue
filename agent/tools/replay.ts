/**
 * 離線重播：把錄音依原始時間餵進真正的 FollowPipeline（和現場同一份程式），輸出箭頭軌跡。
 *
 * 兩種輸入：
 *   --pcm <rec.pcm> --jsonl <rec.jsonl>   眼鏡錄存（recorder.ts 的格式：lines／cursor by gesture 事件按 pcmBytes 重現）
 *   --wav <a.wav> --lines <lines.json>    TTS 測試集（16 kHz mono；lines.json = {"lines":[...]}）
 * 共同：
 *   --whisper http://127.0.0.1:49872      自己起的 whisper-server（絕不要指到 live agent 的 port）
 *   --mode v1|v2                           舊版／新版；--no-jump-confirm 關掉跳躍二輪確認
 *   --out trace.json
 * 用法：node --experimental-strip-types tools/replay.ts --pcm ... --jsonl ... --whisper ... --mode v2 --out out.json
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { FollowPipeline, type FollowEvent } from '../src/follow/pipeline.ts'
import { setWhisperEndpoint } from '../src/listen.ts'

const args = new Map<string, string>()
const flags = new Set<string>()
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i]
  if (a.startsWith('--')) {
    const next = process.argv[i + 1]
    if (next && !next.startsWith('--')) { args.set(a.slice(2), next); i++ } else flags.add(a.slice(2))
  }
}
const need = (k: string) => { const v = args.get(k); if (!v) { console.error(`缺 --${k}`); process.exit(2) } return v }

const whisper = need('whisper')
if (/:8788\b/.test(whisper)) { console.error('不准指到 live agent'); process.exit(2) }
setWhisperEndpoint(whisper)
const mode = args.get('mode') ?? 'v2'
const CHUNK = 1600                     // G2 每包 50 ms
const SR = 16_000

interface Ev { pcmBytes: number; type: string; lines?: string[]; line?: number; by?: string }
let pcm: Buffer
let events: Ev[] = []
if (args.has('pcm')) {
  pcm = readFileSync(need('pcm'))
  events = readFileSync(need('jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l) as Ev)
} else {
  const wav = readFileSync(need('wav'))
  pcm = wav.subarray(44)
  const lines = (JSON.parse(readFileSync(need('lines'), 'utf8')) as { lines: string[] }).lines
  events = [{ pcmBytes: 0, type: 'lines', lines }]
}

const fp = new FollowPipeline({ v2: mode === 'v2', simulateBusy: true, jumpConfirm: !flags.has('no-jump-confirm') })
const trace: Array<[number, number]> = []
const rounds: FollowEvent[] = []
let evIdx = 0
const t0 = Date.now()

function applyEventsUpTo(bytes: number): void {
  while (evIdx < events.length && events[evIdx].pcmBytes <= bytes) {
    const e = events[evIdx++]
    if (e.type === 'lines' && e.lines) {
      // 現場：眼鏡在換張或重新斷行時送 lines，agent 重置箭頭與緩衝（index.ts handleControl 'lines'）
      const same = JSON.stringify(e.lines) === JSON.stringify(fp.lines)
      if (!same) { fp.setLines(e.lines); trace.push([bytes / 2 / SR, fp.cursor]) }
    } else if (e.type === 'cursor' && e.by === 'gesture' && typeof e.line === 'number') {
      fp.setCursor(e.line); trace.push([bytes / 2 / SR, fp.cursor])
    }
  }
}

applyEventsUpTo(0)
for (let off = 0; off < pcm.length; off += CHUNK) {
  applyEventsUpTo(off)
  const ev = await fp.onPcm(pcm.subarray(off, Math.min(pcm.length, off + CHUNK)), SR)
  if (!ev) continue
  rounds.push(ev)
  if (ev.kind === 'move') trace.push([ev.t + (ev.latency ?? 0) + 0.25, ev.cursor])   // +0.25 推估：回手機＋鏡片重繪
}
const out = { mode, whisper, wall: (Date.now() - t0) / 1000, trace, rounds }
writeFileSync(need('out'), JSON.stringify(out, null, 0))
const kinds = rounds.reduce((m, r) => (m[r.kind] = (m[r.kind] ?? 0) + 1, m), {} as Record<string, number>)
console.log(`${mode}: ${rounds.length} 輪 ${JSON.stringify(kinds)}，移動 ${trace.length} 次，${out.wall.toFixed(0)} s`)
