/**
 * 手機端畫面。
 *
 * G2 app 的畫面全推到鏡片上，手機那層若不畫東西就是一片純白——
 * 使用者第一次打開會以為壞掉（這一版就犯過這個錯）。
 *
 * 但它不只是「填滿空白」：把設定搬到這裡，眼鏡端才能一開啟就直接顯示講稿，
 * 不必再問「翻頁方式」「演講多長」。手機有鍵盤、看得清楚，本來就比在鏡片上
 * 用觸控板選單適合做設定。
 *
 * 視覺照 Even app 的設計系統走，才不會格格不入：
 *   #FEF991 是品牌黃，只用在強調，絕不當背景
 *   #3CFA44 是鏡片綠，只准出現在 G2 顯示上，phone UI 不能用
 */

import type { ControlMode, RingInput } from './types.ts'
import { prettyHost } from './host.ts'
import { t, getLang, setLang, type Lang } from './i18n.ts'
import { agentOutdated, AGENT_DOWNLOAD_URL, MIN_AGENT_VERSION } from './version.ts'

export interface PhoneSettings {
  mode: ControlMode
  /** 戒指模式的翻頁手勢 */
  ringInput: RingInput
  durationMin: number
  follow: boolean
  /** 介面語言。鏡片上的字也跟著這個走。 */
  lang: Lang
  /** 使用者手動指定的電腦位址；null 代表自動尋找。 */
  host: string | null
}

export interface PhoneHandlers {
  onModeChange: (mode: ControlMode) => void
  onRingInputChange: (input: RingInput) => void
  onDurationChange: (min: number) => void
  onFollowChange: (on: boolean) => void
  /** 使用者點名要跟哪一份簡報；null 代表回到自動。 */
  onDeckChange: (name: string | null) => void
  /** 使用者手動指定電腦位址；null 代表回到自動尋找。 */
  onHostChange: (host: string | null) => void
  /** 切換介面語言（鏡片上的字也會跟著換）。 */
  onLangChange: (lang: Lang) => void
}

const DURATION_CHOICES = [0, 15, 20, 30, 45, 50, 60, 90, 120]

let handlers: PhoneHandlers
/** 重新掛載（切換語言）時要沿用目前的選擇，不能退回初始值。 */
let mode: ControlMode = 'manual'
let ringInput: RingInput = 'swipe'
let currentDuration = 0
let statusDot: HTMLElement
let statusText: HTMLElement
let slideText: HTMLElement
let hintText: HTMLElement
let followToggle: HTMLInputElement
let followNote: HTMLElement
let deckList: HTMLElement
let deckNote: HTMLElement
let hostInput: HTMLInputElement
let hostNote: HTMLElement

/**
 * 最後一次收到的狀態。切換語言會整個重掛畫面，重掛後要把這些補畫回去，
 * 否則連線狀態會退回「連線中」、簡報清單變空、跟隨開關回到初始值。
 */
let lastStatus: { connected: boolean; hasCache: boolean; rejected: boolean } | null = null
let lastSlide: [number, number, string] | null = null
let lastDecks: [Array<{ name: string; slides: number }>, string | null, string] | null = null
let lastFollow: [boolean, string | undefined] | null = null
/** 最後一次收到的電腦端版本；undefined＝還沒收到 info，null＝收到了但舊版沒回報。 */
let lastAgentVersion: string | null | undefined = undefined

/** 建立手機端畫面。回傳後即可用 update* 函式更新狀態。 */
export function mountPhoneUi(initial: PhoneSettings, h: PhoneHandlers): void {
  handlers = h
  mode = initial.mode
  ringInput = initial.ringInput
  currentDuration = initial.durationMin
  setLang(initial.lang)
  injectStyles()

  const app = document.querySelector<HTMLDivElement>('#app')
  if (!app) return

  app.innerHTML = `
    <main class="wrap">
      <header class="head">
        <h1>SlideCue</h1>
        <p class="sub">${t().appSubtitle}</p>
      </header>

      <section class="card status">
        <div class="row">
          <span class="dot" id="dot"></span>
          <span class="stat" id="stat">${t().connecting}</span>
        </div>
        <div class="slide" id="slide">—</div>
        <p class="hint" id="hint"></p>
        <p class="warn" id="agentWarn" hidden></p>
      </section>

      <section class="card">
        <h2>${t().secMode}</h2>
        <div class="seg" id="modeSeg">
          <button data-mode="manual">${t().modeManual}</button>
          <button data-mode="ring">${t().modeRing}</button>
        </div>
        <p class="note" id="modeNote"></p>
        <div id="ringBox">
          <h3>${t().secRingInput}</h3>
          <div class="seg" id="ringSeg">
            <button data-ring="swipe">${t().ringSwipe}</button>
            <button data-ring="press">${t().ringPress}</button>
            <button data-ring="both">${t().ringBoth}</button>
          </div>
          <p class="note" id="ringNote"></p>
        </div>
      </section>

      <section class="card">
        <h2>${t().secCode}</h2>
        <div class="hostRow">
          <input id="hostInput" type="text" inputmode="numeric" autocapitalize="off"
                 autocorrect="off" spellcheck="false" placeholder="${t().codePlaceholder}" maxlength="40">
          <button id="hostSave" class="mini">${t().codeConnect}</button>
        </div>
        <p class="note" id="hostNote">${t().codeNote}</p>
      </section>

      <section class="card">
        <h2>${t().secDeck}</h2>
        <div class="decks" id="deckList"></div>
        <p class="note" id="deckNote">${t().deckAutoNote}</p>
      </section>

      <section class="card">
        <h2>${t().secFollow}</h2>
        <label class="switch">
          <input type="checkbox" id="followChk">
          <span>${t().followLabel}</span>
        </label>
        <p class="note" id="followNote">${t().followNoteOff}</p>
      </section>

      <section class="card">
        <h2>${t().secDuration}</h2>
        <div class="chips" id="durChips"></div>
        <p class="note">${t().durationNote}</p>
      </section>

      <section class="card">
        <h2>${t().secLang}</h2>
        <div class="seg" id="langSeg">
          <button data-lang="zh">繁體中文</button>
          <button data-lang="en">English</button>
        </div>
      </section>

      <footer class="foot">
        ${t().footer}
      </footer>
    </main>
  `

  statusDot = app.querySelector('#dot')!
  statusText = app.querySelector('#stat')!
  slideText = app.querySelector('#slide')!
  hintText = app.querySelector('#hint')!

  // 翻頁方式
  const seg = app.querySelector('#modeSeg')!
  seg.querySelectorAll<HTMLButtonElement>('button').forEach(b => {
    b.addEventListener('click', () => {
      const mode = b.dataset.mode as ControlMode
      setModeActive(mode)
      handlers.onModeChange(mode)
    })
  })
  // 戒指操作（只在選了 R1 戒指時顯示）
  app.querySelector('#ringSeg')!.querySelectorAll<HTMLButtonElement>('button').forEach(b => {
    b.addEventListener('click', () => {
      const r = b.dataset.ring as RingInput
      setRingActive(r)
      handlers.onRingInputChange(r)
    })
  })
  hostInput = app.querySelector('#hostInput') as HTMLInputElement
  hostNote = app.querySelector('#hostNote') as HTMLElement
  hostInput.value = initial.host ?? ''
  const commitHost = (): void => {
    const raw = hostInput.value.trim()
    handlers.onHostChange(raw || null)
    hostNote.textContent = raw
      ? (/^\d{1,3}$/.test(raw)
          // 三位數會被展開成多個常見網段一起試，講清楚它在做什麼，
          // 否則使用者會以為只打三個數字不可能連得上
          ? t().codeSearching(raw)
          : t().codeConnectingTo(raw))
      : t().codeCleared
  }
  ;(app.querySelector('#hostSave') as HTMLButtonElement).addEventListener('click', commitHost)
  hostInput.addEventListener('keydown', e => { if (e.key === 'Enter') commitHost() })

  deckList = app.querySelector('#deckList') as HTMLElement
  deckNote = app.querySelector('#deckNote') as HTMLElement

  followToggle = app.querySelector('#followChk') as HTMLInputElement
  followNote = app.querySelector('#followNote') as HTMLElement
  followToggle.checked = initial.follow
  followToggle.addEventListener('change', () => handlers.onFollowChange(followToggle.checked))

  // 語言切換：整個畫面重新掛載一次最單純，而且不會漏翻任何角落。
  // 設定頁的重繪成本可以忽略——它不像鏡片那樣每次更新都要走一趟藍牙。
  const langSeg = app.querySelector('#langSeg') as HTMLElement
  langSeg.querySelectorAll<HTMLButtonElement>('button').forEach(b => {
    b.classList.toggle('on', b.dataset.lang === getLang())
    b.addEventListener('click', () => {
      const l = b.dataset.lang as Lang
      if (l === getLang()) return
      setLang(l)
      handlers.onLangChange(l)
      mountPhoneUi({
        ...initial,
        mode,
        ringInput,
        durationMin: currentDuration,
        lang: l,
        follow: followToggle.checked,
        host: hostInput.value.trim() || null,
      }, h)
      restoreState()
    })
  })

  setRingActive(initial.ringInput)
  setModeActive(initial.mode)

  // 演講時長
  const chips = app.querySelector('#durChips')!
  for (const m of DURATION_CHOICES) {
    const b = document.createElement('button')
    b.textContent = m === 0 ? t().durationOff : t().durationMin(m)
    b.dataset.min = String(m)
    b.addEventListener('click', () => {
      setDurationActive(m)
      handlers.onDurationChange(m)
    })
    chips.appendChild(b)
  }
  setDurationActive(initial.durationMin)
}

function setModeActive(m: ControlMode): void {
  mode = m
  const seg = document.querySelector('#modeSeg')
  seg?.querySelectorAll<HTMLButtonElement>('button').forEach(b => {
    b.classList.toggle('on', b.dataset.mode === m)
  })
  const note = document.querySelector('#modeNote')
  if (note) {
    note.textContent = mode === 'ring' ? t().modeNoteRing : t().modeNoteManual
  }
  const box = document.querySelector<HTMLElement>('#ringBox')
  if (box) box.style.display = mode === 'ring' ? '' : 'none'
}

function setRingActive(r: RingInput): void {
  ringInput = r
  document.querySelector('#ringSeg')?.querySelectorAll<HTMLButtonElement>('button').forEach(b => {
    b.classList.toggle('on', b.dataset.ring === r)
  })
  const note = document.querySelector('#ringNote')
  if (note) note.textContent = r === 'press' ? t().ringNotePress : r === 'both' ? t().ringNoteBoth : t().ringNoteSwipe
}

function setDurationActive(min: number): void {
  currentDuration = min
  document.querySelectorAll<HTMLButtonElement>('#durChips button').forEach(b => {
    b.classList.toggle('on', Number(b.dataset.min) === min)
  })
}

/** 更新連線狀態。 */
export function updatePhoneStatus(connected: boolean, hasCache: boolean, rejected = false): void {
  lastStatus = { connected, hasCache, rejected }
  if (!statusDot) return
  statusDot.className = 'dot ' + (connected ? 'ok' : hasCache ? 'warn' : 'off')
  statusText.textContent = connected ? t().connected : hasCache ? t().offline : t().disconnected
  // 被 agent 拒絕（它鎖定了另一台）要講清楚，否則使用者只會看到「請啟動 SlideCue」，
  // 可是電腦上明明開著。
  hintText.textContent = connected ? '' : rejected ? t().hintRejected : t().hintNotConnected
}

/** 語言切換重掛後，把最後的狀態補畫回去。 */
function restoreState(): void {
  if (lastStatus) updatePhoneStatus(lastStatus.connected, lastStatus.hasCache, lastStatus.rejected)
  if (lastSlide) updatePhoneSlide(...lastSlide)
  if (lastDecks) updatePhoneDecks(...lastDecks)
  // 錯誤訊息是切換前的語言，不重播；只還原開關狀態
  if (lastFollow) updatePhoneFollow(lastFollow[0])
  if (lastAgentVersion !== undefined) updatePhoneAgentVersion(lastAgentVersion ?? undefined)
}

/**
 * 電腦端太舊就提示重新下載。
 *
 * 只在收到 agent 的 info 之後才判斷——沒連上時不知道電腦端是哪一版，不能亂叫人更新。
 */
export function updatePhoneAgentVersion(reported: string | undefined): void {
  lastAgentVersion = reported ?? null
  const el = document.querySelector<HTMLElement>('#agentWarn')
  if (!el) return
  if (!agentOutdated(reported)) { el.hidden = true; return }
  el.hidden = false
  el.innerHTML = ''
  el.append(t().agentOutdated(reported ?? '1.0.0', MIN_AGENT_VERSION) + ' ')
  const a = document.createElement('a')
  a.href = AGENT_DOWNLOAD_URL
  a.target = '_blank'
  a.rel = 'noopener'
  a.textContent = AGENT_DOWNLOAD_URL.replace(/^https:\/\//, '').replace(/\/$/, '')
  el.append(a)
}

/**
 * 顯示位址搜尋的結果。
 *
 * 連不上時最折磨人的是不知道它到底試了什麼。把試過的位址攤開來講，
 * 使用者自己就能判斷是「手機不在同一個網路」還是「agent 根本沒跑」。
 */
export function updatePhoneProbe(tried: string[], found: string | null): void {
  if (!hintText) return
  if (found) {
    const pretty = prettyHost(found)
    hintText.textContent = t().hintFound(pretty)
    // 回填實際連上的位址：使用者看得到「現在連的是哪一台」，
    // 換場地連不上時也知道該改什麼。
    if (hostInput && document.activeElement !== hostInput) hostInput.value = pretty
    if (hostNote) hostNote.textContent = t().codeNote
    return
  }
  const list = tried.map(prettyHost).join('、')
  hintText.textContent = tried.length ? t().hintSearching(list) : t().hintNotConnected
}

/**
 * 列出 Keynote 開著的簡報，讓使用者點名指定要跟哪一份。
 *
 * 「自動」永遠排第一且是預設：多數時候按下播放就對了，
 * 這份清單是給「開了好幾份、上台前想先確認講稿」的情況用的。
 */
export function updatePhoneDecks(
  docs: Array<{ name: string; slides: number }>,
  pinned: string | null,
  active: string,
): void {
  lastDecks = [docs, pinned, active]
  if (!deckList) return

  if (docs.length === 0) {
    deckList.innerHTML = `<p class="empty">${escapeHtml(t().deckEmpty)}</p>`
    deckNote.textContent = t().deckEmptyNote
    return
  }

  const rows = [
    `<button class="deck ${pinned === null ? 'on' : ''}" data-name="">
       <span class="dname">${escapeHtml(t().deckAuto)}</span>
       <span class="dmeta">${active ? escapeHtml(t().deckFollowing(active)) : ''}</span>
     </button>`,
    ...docs.map(d => `
      <button class="deck ${pinned === d.name ? 'on' : ''}" data-name="${escapeHtml(d.name)}">
        <span class="dname">${escapeHtml(d.name)}</span>
        <span class="dmeta">${escapeHtml(t().deckSlides(d.slides))}</span>
      </button>`),
  ]
  deckList.innerHTML = rows.join('')

  deckList.querySelectorAll<HTMLButtonElement>('.deck').forEach(b => {
    b.addEventListener('click', () => handlers.onDeckChange(b.dataset.name || null))
  })

  deckNote.textContent = pinned ? t().deckPinned(pinned) : t().deckAutoNote
}

/** 簡報檔名會直接進 HTML，必須跳脫——檔名是使用者取的，什麼字元都可能有。 */
function escapeHtml(t: string): string {
  return t.replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c)
}

/**
 * 反映語音跟隨的實際狀態。
 *
 * 特別重要的是**失敗時要把開關撥回去**：麥克風拿不到卻讓開關停在「開」，
 * 講者會對著不動的箭頭一直念，卻完全不知道問題在哪。
 */
/**
 * 顯示辨識模型的下載進度。
 *
 * 開了語音跟隨卻什麼都沒發生，使用者只會以為壞了。141 MB 在一般網路上
 * 要一兩分鐘，那段時間必須看得到東西在動。
 */
export function updatePhoneModelDownload(percent: number | null): void {
  if (!followNote) return
  if (percent === null) return
  followNote.textContent = t().followDownloading(percent)
}

export function updatePhoneFollow(on: boolean, error?: string): void {
  lastFollow = [on, error]
  if (!followToggle) return
  followToggle.checked = on
  followNote.textContent = error
    ? t().followError(error)
    : on ? t().followNoteOn : t().followNoteOff
}

/** 更新目前投影片與講稿摘要。 */
export function updatePhoneSlide(slide: number, total: number, notes: string): void {
  lastSlide = [slide, total, notes]
  if (!slideText) return
  slideText.textContent = total > 0
    ? t().slideOf(slide, total,
        notes ? notes.slice(0, 24) + (notes.length > 24 ? '…' : '') : t().noScriptForSlide)
    : t().waitingKeynote
}

function injectStyles(): void {
  const css = `
    .switch { display:flex; align-items:center; gap:.6rem; cursor:pointer; }
    .decks { display:flex; flex-direction:column; gap:.4rem; }
    .deck { display:flex; justify-content:space-between; align-items:center; gap:1rem;
            width:100%; text-align:left; padding:.7rem .85rem; border-radius:.6rem;
            border:1px solid rgba(255,255,255,.14); background:transparent;
            color:inherit; font:inherit; cursor:pointer; }
    .deck.on { border-color: var(--accent, #FEF991);
               background: color-mix(in srgb, var(--accent, #FEF991) 12%, transparent); }
    .dname { font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .dmeta { opacity:.6; font-size:.82rem; flex:none; }
    .empty { opacity:.6; font-size:.9rem; margin:0; }
    .hostRow { display:flex; gap:.5rem; }
    .hostRow input { flex:1; min-width:0; padding:.6rem .7rem; border-radius:.6rem;
                     border:1px solid rgba(255,255,255,.18); background:transparent;
                     color:inherit; font:inherit; }
    .mini { flex:none; padding:.6rem .9rem; border-radius:.6rem; border:0;
            background: var(--accent, #FEF991); color:#1a1a1a; font:inherit;
            font-weight:600; cursor:pointer; }
    .switch input { width:1.15rem; height:1.15rem; accent-color: var(--accent, #FEF991); }

    :root {
      --text: #232323; --text-dim: #7B7B7B;
      --bg: #FFFFFF; --surface: #F4F4F4; --line: #E4E4E4;
      --accent: #FEF991;
      --ok: #2E9E4F; --warn: #B8860B; --off: #B0B0B0;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --text: #FFFFFF; --text-dim: #8A8A8A;
        --bg: #111111; --surface: #1A1A1A; --line: #2A2A2A;
        --ok: #4ED37A; --warn: #D3A344; --off: #5A5A5A;
      }
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; background: var(--bg); color: var(--text);
      font-family: "FK Grotesk Neue", "Source Han Sans", -apple-system, system-ui, sans-serif; }
    .wrap { max-width: 560px; margin: 0 auto; padding: 20px 20px 40px; }

    .head { margin-bottom: 24px; }
    .head h1 { margin: 0; font-size: 24px; font-weight: 600; letter-spacing: -.02em; }
    .head .sub { margin: 4px 0 0; font-size: 13px; color: var(--text-dim); }

    .card { background: var(--surface); border-radius: 14px; padding: 16px; margin-bottom: 16px; }
    .card h2 { margin: 0 0 12px; font-size: 16px; font-weight: 500; }
    .card h3 { margin: 16px 0 10px; font-size: 14px; font-weight: 500; }

    .status .row { display: flex; align-items: center; gap: 8px; }
    .dot { width: 9px; height: 9px; border-radius: 50%; background: var(--off); flex: none; }
    .dot.ok { background: var(--ok); } .dot.warn { background: var(--warn); }
    .stat { font-size: 16px; font-weight: 500; }
    .slide { margin-top: 10px; font-size: 14px; color: var(--text-dim);
      font-variant-numeric: tabular-nums; line-height: 1.5; }
    .hint { margin: 10px 0 0; font-size: 13px; color: var(--text-dim); line-height: 1.6; }
    .warn { margin: 12px 0 0; padding: 10px 12px; border-radius: 10px; font-size: 13px; line-height: 1.6;
            background: rgba(230, 150, 30, .14); color: var(--text); }
    .warn a { color: inherit; font-weight: 500; text-decoration: underline; }

    .seg { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: 8px; }
    .seg button, .chips button {
      appearance: none; border: 1px solid var(--line); background: var(--bg);
      color: var(--text); border-radius: 10px; padding: 11px 12px;
      font-size: 15px; font-family: inherit; cursor: pointer;
    }
    .seg button.on, .chips button.on {
      background: var(--accent); border-color: var(--accent); color: #232323; font-weight: 500;
    }
    .seg button:focus-visible, .chips button:focus-visible { outline: 2px solid var(--text); outline-offset: 2px; }

    .chips { display: flex; flex-wrap: wrap; gap: 8px; }
    .chips button { flex: 1 1 auto; min-width: 68px; }

    .note { margin: 10px 0 0; font-size: 13px; color: var(--text-dim); line-height: 1.6; }
    .foot { margin-top: 24px; font-size: 12px; color: var(--text-dim); text-align: center; }
  `
  const style = document.createElement('style')
  style.textContent = css
  document.head.appendChild(style)
}
