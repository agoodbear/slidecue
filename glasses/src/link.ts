/**
 * 與 Mac agent 的連線。
 *
 * ## 為什麼要「找」而不是直接連
 *
 * 早期版本寫死 `ws://${location.hostname}:8788`，因為當時 app 是從 Mac 上的
 * dev server 載入的——頁面來自哪台機器，agent 就在哪台機器。
 *
 * 但**從 Even Hub 安裝的正式版不是這樣**：頁面來自 Even 的 bundle，
 * `location.hostname` 指向手機自己，於是 WebSocket 永遠連不到 Mac，
 * 而且是完全靜默的失敗——畫面就只是一片空白。
 *
 * 所以這裡改成平行競速：同時對所有可能的位址開連線，誰先握手成功就用誰，
 * 其餘立刻關掉。使用者不必知道 IP，換網路也不必重設。
 *
 * 候選位址的順序即偏好順序（見 buildCandidates）：
 *   1. 上次成功的位址——同一個場地第二次開，幾乎都是它
 *   2. 使用者輸入的連線碼／位址——三位數會展開成多個常見網段一起試
 *   3. `location.hostname`——dev server 那條老路，保留著才不會回頭壞掉
 *
 * 不寫死 mDNS 名稱或 Tailscale 位址：商店發布的是同一份 bundle，
 * 寫死等於把開發者的網路資訊發給所有人。
 */

import type { AgentMessage, ControlMessage, ControlMode } from './types.ts'
import { candidatesFromInput } from './host.ts'

const PORT = 8788

/** 重連退避的下限與上限。台上斷線要盡快回來，所以起始值壓得很低。 */
const RETRY_MIN_MS = 400
const RETRY_MAX_MS = 5000

/** 競速探測的等待上限。超過這個時間沒人接，就當這一輪全滅。 */
const PROBE_TIMEOUT_MS = 2500

/**
 * 多久沒收到 agent 任何訊息就判定連線已死。
 *
 * 手機掉 Wi-Fi 時，iOS 可能要幾十秒才讓 WebSocket 報 close，那段時間鏡片凍住、
 * 卻不顯示「■ 離線」。agent 每 5 秒送一次心跳，15 秒沒聲音就自己斷開重連。
 * 只有「這條連線上收過心跳」才啟用——舊版 agent 不送心跳，不能因此每 15 秒斷一次。
 */
const DEAD_AFTER_MS = 15_000

/**
 * 組出這一輪要競速的候選位址。
 *
 * 順序即偏好順序，但因為是平行競速，順序只影響「同時通時偏好誰」。
 *
 * ⚠️ 這裡刻意**不含任何寫死的位址**。每台電腦的位址都不一樣，
 * 而商店發布的是同一份 bundle——寫死等於把開發者的網路資訊發給所有人。
 */
function buildCandidates(remembered: string | null, code: string | null): string[] {
  const list: string[] = []
  const push = (url: string | null | undefined): void => {
    if (url && !list.includes(url)) list.push(url)
  }

  // 上次成功的位址。同一個場地第二次開，幾乎都是它命中。
  push(remembered)

  // 使用者輸入的連線碼／位址。三位數會展開成多個常見網段。
  if (code) for (const c of candidatesFromInput(code, PORT)) push(c)

  // dev server 路徑：頁面若來自電腦上的開發伺服器，agent 就在同一台。
  // localhost 代表頁面來自手機自己，那條一定不是 agent。
  const h = location.hostname
  if (h && h !== 'localhost' && h !== '127.0.0.1') push(`ws://${h}:${PORT}`)

  return list
}

export interface LinkHandlers {
  onMessage: (msg: AgentMessage) => void
  onConnectedChange: (connected: boolean) => void
  /** 找到可用位址時通知外面存起來，下次開場直接命中。 */
  onHostFound?: (url: string) => void
  /** 探測進度，給手機端顯示——連不上時使用者至少看得到它試過哪些位址。 */
  onProbe?: (info: { tried: string[]; found: string | null }) => void
  /** agent 拒絕了這台裝置（它鎖定了另一台）。 */
  onRejected?: () => void
}

export class AgentLink {
  private ws: WebSocket | null = null
  private retry = RETRY_MIN_MS
  private closed = false
  private pendingMode: ControlMode | null = null
  private handlers: LinkHandlers
  /** 上次成功的位址。命中後就不再每次都跑完整輪競速。 */
  private known: string | null = null
  /**
   * 是否正在競速。
   *
   * ⚠️ 沒有這道閘門會炸掉整套系統：competing 一輪要等滿 2.5 秒逾時，
   * 期間退避計時器又會觸發下一輪，每輪各開 3 條連線，於是連線數
   * 指數成長。實測 30 秒內衝到 19 條，agent 要對每條推送整份講稿，
   * 直接被自己的重連打死——而且是在台上才會發生。
   */
  private connecting = false
  /** 排定中的重連計時器。連上之後要取消，否則它照樣會再開一輪。 */
  private retryTimer: ReturnType<typeof setTimeout> | null = null

  /** 使用者輸入的連線碼或完整位址。null 代表只靠記住的位址。 */
  private code: string | null = null

  /** 這條連線最後一次收到訊息的時間，與是否收過心跳。 */
  private lastMsgAt = 0
  private sawHeartbeat = false
  private watchdog: ReturnType<typeof setInterval> | null = null

  constructor(handlers: LinkHandlers, remembered: string | null = null, code: string | null = null) {
    this.handlers = handlers
    this.known = remembered
    this.code = code

    // 手機解鎖、app 回到前景時立刻重連，不必等退避計時器
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible' || this.closed) return
        // 剛回前景時排隊的訊息還沒處理，給心跳一個完整的寬限期，免得誤判連線已死
        this.lastMsgAt = Date.now()
        if (this.ws?.readyState === WebSocket.OPEN) return
        this.retry = RETRY_MIN_MS
        void this.connect()
      })
    }
  }

  /** 連線已死但 close 事件遲遲不來：自己拆掉，照斷線流程走。 */
  private drop(ws: WebSocket): void {
    if (this.ws !== ws) return
    ws.onclose = null
    ws.onmessage = null
    ws.onerror = null
    try { ws.close() } catch { /* 已經壞了就算了 */ }
    this.ws = null
    this.stopWatchdog()
    this.handlers.onConnectedChange(false)
    this.scheduleRetry()
  }

  private stopWatchdog(): void {
    if (this.watchdog) clearInterval(this.watchdog)
    this.watchdog = null
  }

  /**
   * 對一個位址開連線，回報它是否握手成功。
   *
   * 刻意**不在這裡掛 onmessage**：競速階段可能同時有好幾條連線，
   * 訊息要等勝出者確定之後才接，否則會重複處理。
   */
  private probe(url: string): Promise<WebSocket | null> {
    return new Promise(resolve => {
      let ws: WebSocket
      try {
        ws = new WebSocket(url)
      } catch {
        resolve(null)
        return
      }
      const timer = setTimeout(() => {
        ws.close()
        resolve(null)
      }, PROBE_TIMEOUT_MS)

      ws.onopen = () => {
        clearTimeout(timer)
        resolve(ws)
      }
      ws.onerror = () => {
        clearTimeout(timer)
        resolve(null)
      }
      ws.onclose = () => {
        clearTimeout(timer)
        resolve(null)
      }
    })
  }

  async connect(): Promise<void> {
    if (this.closed) return
    if (this.connecting) return          // 上一輪競速還沒結束
    if (this.ws?.readyState === WebSocket.OPEN) return  // 已經連上了

    this.connecting = true
    try {
      await this.race()
    } finally {
      this.connecting = false
    }
  }

  private async race(): Promise<void> {
    const candidates = buildCandidates(this.known, this.code)
    if (candidates.length === 0) {
      this.scheduleRetry()
      return
    }

    // 全部一起開，**第一個握手成功的立刻勝出**——不等其餘候選跑完。
    //
    // 早期版本用 Promise.all 等全部有結果才挑贏家，於是開場一定要等滿
    // 探測逾時（實測 2505 ms）。候選數量因為連線碼展開成多個網段而變多之後，
    // 這個延遲會直接反映在「打開 app 到看到講稿」的等待上。
    // 現在改成誰先成功誰贏，區網命中通常只要幾十毫秒。
    const winner = await new Promise<{ ws: WebSocket; url: string } | null>(resolve => {
      let pending = candidates.length
      let settled = false
      for (const url of candidates) {
        void this.probe(url).then(ws => {
          if (ws && !settled) {
            settled = true
            resolve({ ws, url })
            return
          }
          // 慢一步才連上的：關掉，不要在 agent 那邊留殭屍連線
          if (ws) ws.close()
          if (--pending === 0 && !settled) {
            settled = true
            resolve(null)
          }
        })
      }
    })

    this.handlers.onProbe?.({ tried: candidates, found: winner?.url ?? null })

    if (!winner) {
      this.scheduleRetry()
      return
    }

    const url = winner.url
    if (url !== this.known) {
      this.known = url
      this.handlers.onHostFound?.(url)
    }
    this.attach(winner.ws)
  }

  /** 把勝出的連線接上正式的訊息處理。 */
  private attach(ws: WebSocket): void {
    if (this.closed) {
      ws.close()
      return
    }
    this.ws = ws
    this.retry = RETRY_MIN_MS
    // 連上了就把排隊中的重連取消掉，否則它會在背景再開一輪競速
    if (this.retryTimer) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }
    this.handlers.onConnectedChange(true)

    // 重連後把模式補送一次，避免 agent 用到過期的模式
    if (this.pendingMode) this.setMode(this.pendingMode)
    this.send({ type: 'control', action: 'resync' })

    this.lastMsgAt = Date.now()
    this.sawHeartbeat = false
    this.stopWatchdog()
    this.watchdog = setInterval(() => {
      if (this.sawHeartbeat && Date.now() - this.lastMsgAt > DEAD_AFTER_MS) {
        console.warn('[link] 心跳逾時，判定連線已死')
        this.drop(ws)
      }
    }, 3000)

    ws.onmessage = ev => {
      this.lastMsgAt = Date.now()
      try {
        const msg = JSON.parse(String(ev.data)) as AgentMessage
        if (msg.type === 'hb') {
          this.sawHeartbeat = true
          return
        }
        this.handlers.onMessage(msg)
      } catch (err) {
        // 壞掉的封包直接丟掉，不要讓台上的畫面因此中斷
        console.warn('[link] 封包解析失敗', err)
      }
    }

    ws.onclose = ev => {
      console.log('[link] 連線關閉', ev.code, ev.reason)
      this.ws = null
      this.stopWatchdog()
      this.handlers.onConnectedChange(false)
      // 1008＝agent 只服務另一台裝置。要讓使用者知道，否則只會看到「請啟動 SlideCue」
      if (ev.code === 1008) {
        this.handlers.onRejected?.()
        // 被拒絕時不要用最短間隔一直敲門：agent 每次都記一筆「拒絕」，log 會膨脹
        this.retry = RETRY_MAX_MS
      }
      this.scheduleRetry()
    }

    ws.onerror = () => {
      console.warn('[link] 連線錯誤')
      ws.close()
    }
  }

  private scheduleRetry(): void {
    if (this.closed) return
    // 同一時間只留一個待辦的重連
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      void this.connect()
    }, this.retry)
    this.retry = Math.min(this.retry * 2, RETRY_MAX_MS)
  }

  send(msg: ControlMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg))
    }
  }

  setMode(mode: ControlMode): void {
    this.pendingMode = mode
    this.send({ type: 'mode', mode })
  }

  /**
   * 手機端輸入連線碼或位址時用。
   *
   * 記住的位址一併清掉：使用者會來改這裡，通常正是因為記住的那個連不上了。
   */
  useCode(code: string | null): void {
    this.code = code
    this.known = null
    this.retry = RETRY_MIN_MS
    this.ws?.close()
    if (!this.ws) void this.connect()
  }

  close(): void {
    this.closed = true
    this.stopWatchdog()
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.ws?.close()
  }
}
