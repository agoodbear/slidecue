/**
 * network 白名單探針。
 *
 * ## 要回答什麼
 *
 * Even Hub 的 `network` 權限帶一份白名單，官方文件寫「不在清單上的一律擋掉，
 * 連流量都不會產生」，而且**只吃完整 origin，不支援裸主機名、萬用字元與 IP**。
 * SlideCue 連的是使用者自己那台 Mac（`ws://192.168.x.x:8788`），因人而異、
 * 因網路而異，打包時不可能預先知道——**填不進白名單**。
 *
 * 但官方那頁網路文件通篇只點名 `fetch()` 與 `XMLHttpRequest`，沒提 WebSocket。
 * 而 SlideCue 的 `permissions` 一直是空的、WebSocket 一路都通。
 * 所以真正的問題是：**WebSocket 到底受不受這道白名單管？**
 *
 * 這題決定要不要做中繼服務，所以要用實測回答，不是用推測。
 *
 * ## 為什麼一定要有對照組
 *
 * 「被白名單擋掉」和「那台伺服器本來就死了」從 JavaScript 看起來一模一樣，
 * 兩者都只是一個 error 事件。所以每一種通道都測**白名單內**與**白名單外**各一次：
 * 白名單內那次通了，才證明這個通道與這台伺服器本身沒問題，
 * 白名單外那次的失敗才能被解讀成「被擋」。
 *
 * 耗時也一起記。白名單是送出請求前就攔下來，應該是**幾毫秒內**就失敗；
 * 真的連不上對方伺服器會拖到數百毫秒甚至逾時。這個差距是第二個判別依據。
 *
 * ## 判讀
 *
 * | B（白名單外的 fetch） | D（白名單外的 WebSocket） | 結論 |
 * |---|---|---|
 * | 通 | — | 白名單根本沒啟用強制，本題不成立 |
 * | 擋 | 通 | **WebSocket 不受管 → 可以直接送審，中繼非必要** |
 * | 擋 | 擋 | **WebSocket 受管 → 中繼是上架前提** |
 *
 * E（連使用者自己的 Mac）是真實情境的直接驗證，以它為準。
 *
 * 用法：這支要當 `entrypoint` 打包成測試版裝上真機才有意義。
 * 模擬器不做白名單強制（查過原始碼，simulator 套件裡沒有任何 whitelist 邏輯），
 * 強制點在手機上的 Even app，所以模擬器跑這支永遠全綠，沒有參考價值。
 */

import {
  waitForEvenAppBridge,
  CreateStartUpPageContainer,
  TextContainerProperty,
  TextContainerUpgrade,
} from '@evenrealities/even_hub_sdk'
import { expandShortCode, AGENT_PORT } from './host.ts'

declare const __APP_VERSION__: string
const VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '?'

/** 單項探測的上限。超過就當逾時，避免一項卡死拖垮整份報告。 */
const TIMEOUT_MS = 8000

/**
 * 白名單內的靶。這兩個要跟 app.json 的 whitelist 完全一致，改一邊就要改另一邊。
 *
 * `ws.postman-echo.com` 在 app.json 裡**只宣告 `wss://` 這個寫法**，
 * 順便回答第二個小問題：白名單收不收 `wss://` scheme。
 */
const IN_FETCH = 'https://api.github.com/zen'
const IN_WS = 'wss://ws.postman-echo.com/raw'

/**
 * 白名單外的靶。
 *
 * 兩個都在 2026-08-22 實測活著且回應 `Access-Control-Allow-Origin: *`——
 * 沒有 CORS 標頭的話，瀏覽器擋下來的 CORS 錯誤會跟白名單擋下來的長得一樣，
 * 對照組就失效了。（`echo.websocket.events` 已經死掉，不要用。）
 */
const OUT_FETCH = 'https://api.ipify.org/?format=json'
const OUT_WS = 'wss://echo.websocket.org'

type Verdict = 'RUN' | 'OK' | 'BLOCKED' | 'TIMEOUT' | 'SKIP'

/** 單項探測的結果。`detail` 存原始錯誤字串，判讀不出來時要靠它。 */
interface ProbeResult {
  verdict: Verdict
  ms: number
  detail: string
}

interface Row {
  key: string
  chan: string
  scope: string
  verdict: Verdict
  ms: number
  detail: string
}

const rows: Row[] = [
  { key: 'A', chan: 'fetch', scope: 'in ', verdict: 'RUN', ms: 0, detail: '白名單內，對照組' },
  { key: 'B', chan: 'fetch', scope: 'out', verdict: 'RUN', ms: 0, detail: '白名單外，驗證強制是否啟用' },
  { key: 'C', chan: 'ws   ', scope: 'in ', verdict: 'RUN', ms: 0, detail: '白名單內（宣告成 wss://）' },
  { key: 'D', chan: 'ws   ', scope: 'out', verdict: 'RUN', ms: 0, detail: '白名單外 ← 核心問題' },
  { key: 'E', chan: 'ws   ', scope: 'lan', verdict: 'RUN', ms: 0, detail: '連自己的 Mac ← 真實情境' },
]

const bridge = await waitForEvenAppBridge()

// ── 鏡片 ────────────────────────────────────────────────────────────────
// 全部用 ASCII。G2 字型缺字會被靜默跳過（實測「稿」就消失過），
// 而這份報告要是少了一個字元，判讀就會出錯。

const CONTAINER_ID = 1
const CONTAINER_NAME = 'wlprobe'

function lensText(): string {
  const head = `SlideCue whitelist probe ${VERSION}`
  const body = rows.map(r => {
    const ms = r.verdict === 'RUN' || r.verdict === 'SKIP' ? '' : `${r.ms}ms`
    return `${r.key} ${r.chan} ${r.scope} ${r.verdict.padEnd(8)}${ms}`
  })
  return [head, ...body].join('\n')
}

await bridge.createStartUpPageContainer(
  new CreateStartUpPageContainer({
    containerTotalNum: 1,
    textObject: [
      new TextContainerProperty({
        xPosition: 0,
        yPosition: 0,
        width: 576,
        height: 288,
        paddingLength: 4,
        borderWidth: 0,
        containerID: CONTAINER_ID,
        containerName: CONTAINER_NAME,
        isEventCapture: 1,
        content: lensText(),
      }),
    ],
  }),
)

async function repaint(): Promise<void> {
  await bridge.textContainerUpgrade(
    new TextContainerUpgrade({
      containerID: CONTAINER_ID,
      containerName: CONTAINER_NAME,
      content: lensText(),
    }),
  )
  paintPhone()
}

// ── 手機畫面 ────────────────────────────────────────────────────────────
// 鏡片放判讀結果，手機放完整錯誤字串——鏡片只有 576px 寬，塞不下。

const app = document.getElementById('app') ?? document.body

function paintPhone(): void {
  app.innerHTML = `
    <div style="font:14px/1.5 -apple-system,system-ui,sans-serif;padding:16px;max-width:640px">
      <h2 style="margin:0 0 4px;font-size:17px">network 白名單探針</h2>
      <div style="color:#666;margin-bottom:14px">SlideCue ${VERSION}</div>
      <table style="border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums">
        <tbody>
          ${rows.map(r => `
            <tr style="border-bottom:1px solid #eee">
              <td style="padding:7px 6px 7px 0;font-weight:600">${r.key}</td>
              <td style="padding:7px 6px 7px 0">${r.chan.trim()}</td>
              <td style="padding:7px 6px 7px 0;color:#666">${r.scope.trim()}</td>
              <td style="padding:7px 6px 7px 0;font-weight:600;color:${
                r.verdict === 'OK' ? '#0a7' : r.verdict === 'RUN' ? '#999' : '#c33'
              }">${r.verdict}</td>
              <td style="padding:7px 0;text-align:right;color:#666">${
                r.verdict === 'RUN' || r.verdict === 'SKIP' ? '' : r.ms + 'ms'
              }</td>
            </tr>
            <tr><td colspan="5" style="padding:0 0 8px;color:#888;font-size:12px">${r.detail}</td></tr>
          `).join('')}
        </tbody>
      </table>
      <div style="margin-top:16px;padding:12px;background:#f6f6f6;border-radius:8px;font-size:13px;line-height:1.6">
        ${verdictText()}
      </div>
    </div>`
}

/** 把五個結果翻成一句人話結論，免得還要對著表格自己推。 */
function verdictText(): string {
  const g = (k: string) => rows.find(r => r.key === k)!
  if (rows.some(r => r.verdict === 'RUN')) return '測試進行中…'
  if (g('A').verdict !== 'OK') {
    return '⚠️ 對照組 A 就失敗了 — 可能根本沒有網路，這份結果不能用。檢查手機連線後重開。'
  }
  if (g('B').verdict === 'OK') {
    return '白名單<b>沒有啟用強制</b>：連白名單外的 fetch 都通了。本題不成立，SlideCue 不受影響。'
  }
  // B 被擋 → 強制確實生效，此時 D 才有解讀價值
  if (g('D').verdict === 'OK') {
    return '✅ <b>WebSocket 不受白名單管</b>（fetch 被擋、WebSocket 通）。SlideCue 可以直接送審，中繼服務非上架必要。'
  }
  return '❌ <b>WebSocket 受白名單管</b>（fetch 與 WebSocket 都被擋）。區網動態位址填不進白名單，中繼服務是上架的前提。'
}

paintPhone()

// ── 探測 ────────────────────────────────────────────────────────────────

/** 一律回報結果，不丟例外——這支的價值在於「每一項都有答案」。 */
async function probeFetch(url: string): Promise<ProbeResult> {
  const t0 = Date.now()
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: ctl.signal, cache: 'no-store' })
    clearTimeout(timer)
    return { verdict: 'OK', ms: Date.now() - t0, detail: `HTTP ${res.status}` }
  } catch (e) {
    clearTimeout(timer)
    const ms = Date.now() - t0
    const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e)
    return { verdict: ctl.signal.aborted ? 'TIMEOUT' : 'BLOCKED', ms, detail: msg }
  }
}

async function probeWs(url: string): Promise<ProbeResult> {
  const t0 = Date.now()
  return new Promise(resolve => {
    let settled = false
    const done = (verdict: Verdict, detail: string) => {
      if (settled) return
      settled = true
      resolve({ verdict, ms: Date.now() - t0, detail })
    }
    let ws: WebSocket
    try {
      ws = new WebSocket(url)
    } catch (e) {
      // 有些實作是在建構子就丟出來的，那更像是被攔截而不是連不上
      done('BLOCKED', e instanceof Error ? `constructor ${e.name}: ${e.message}` : String(e))
      return
    }
    const timer = setTimeout(() => { done('TIMEOUT', `超過 ${TIMEOUT_MS}ms`); try { ws.close() } catch { /* 已經關了 */ } }, TIMEOUT_MS)
    ws.onopen = () => { clearTimeout(timer); done('OK', 'open'); try { ws.close() } catch { /* 已經關了 */ } }
    ws.onerror = () => { clearTimeout(timer); done('BLOCKED', 'error 事件') }
    ws.onclose = ev => { clearTimeout(timer); done('BLOCKED', `close ${ev.code}`) }
  })
}

/** 使用者自己那台 Mac。記住的位址優先，沒有就用連線碼展開後拿第一個。 */
async function lanTarget(): Promise<string | null> {
  const saved = await bridge.getLocalStorage('slidecue.host')
  if (saved) return saved
  const code = await bridge.getLocalStorage('slidecue.code')
  if (code) {
    const list = expandShortCode(code, AGENT_PORT)
    if (list.length) return list[0]
  }
  return null
}

async function run(): Promise<void> {
  const set = async (key: string, r: ProbeResult) => {
    const row = rows.find(x => x.key === key)!
    row.verdict = r.verdict
    row.ms = r.ms
    row.detail = `${row.detail} — ${r.detail}`
    await repaint()
  }

  await set('A', await probeFetch(IN_FETCH))
  await set('B', await probeFetch(OUT_FETCH))
  await set('C', await probeWs(IN_WS))
  await set('D', await probeWs(OUT_WS))

  const lan = await lanTarget()
  if (!lan) {
    await set('E', { verdict: 'SKIP', ms: 0, detail: '手機上沒有存過電腦位址，先用正式版連一次再測' })
  } else {
    await set('E', { ...(await probeWs(lan)), detail: lan })
  }

  console.log('[whitelist-probe] 完成', JSON.stringify(rows))
}

void run()
