/**
 * 介面語言。
 *
 * 兩處要翻：手機上的設定畫面，以及**鏡片上的字**。後者更要緊——
 * 那是講者上台時唯一看得到的東西。
 *
 * ⚠️ 鏡片上的字有寬度上限（見 ui.ts 的實測值），而英文與中文的字寬差很多。
 * 所有進到鏡片的字串都必須通過 clock.ts 既有的降級機制，不能假設放得下。
 */

export type Lang = 'zh' | 'en'

/**
 * 依系統語言決定預設。
 *
 * 只認語言不認地區：`zh-TW`、`zh-HK`、`zh` 都給繁體，其餘給英文。
 * 簡體（`zh-CN`）也會落到 zh——對提詞機來說，看得懂比字體正確重要，
 * 而使用者隨時可以自己切。
 */
export function detectLang(): Lang {
  const raw = (typeof navigator !== 'undefined' ? navigator.language : '') || ''
  return raw.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

interface Strings {
  /* ── 鏡片上的字（有寬度限制，要短） ── */
  lensNow: string
  lensElapsed: string
  lensCountdown: string
  lensCountdownShort: string
  lensOvertime: string
  lensNoScript: string
  lensMinute: string          // 分鐘單位，例如「分」

  /* ── 手機設定畫面 ── */
  appSubtitle: string
  connecting: string
  connected: string
  offline: string
  disconnected: string
  hintNotConnected: string
  /** agent 只服務另一台裝置，拒絕了這支手機。 */
  hintRejected: string
  hintFound: (host: string) => string
  hintSearching: (list: string) => string
  waitingKeynote: string
  slideOf: (n: number, total: number, notes: string) => string
  noScriptForSlide: string

  secCode: string
  codePlaceholder: string
  codeConnect: string
  codeNote: string
  codeSearching: (code: string) => string
  codeConnectingTo: (host: string) => string
  codeCleared: string

  secDeck: string
  deckAuto: string
  deckAutoNote: string
  deckPinned: (name: string) => string
  deckEmpty: string
  deckEmptyNote: string
  deckSlides: (n: number) => string
  deckFollowing: (name: string) => string

  secFollow: string
  followLabel: string
  followNoteOff: string
  followNoteOn: string
  followError: (msg: string) => string
  followMicFailed: string
  followDownloading: (pct: number) => string
  followFirstUse: string

  secMode: string
  modeManual: string
  modeRing: string
  modeNoteRing: string
  modeNoteManual: string

  secDuration: string
  durationNote: string
  durationOff: string
  durationMin: (n: number) => string

  secLang: string
  footer: string
}

const zh: Strings = {
  lensNow: '現在',
  lensElapsed: '授課',
  lensCountdown: '下課倒數',
  lensCountdownShort: '倒數',
  lensOvertime: '已超時',
  lensNoScript: '（這張沒有講稿）',
  lensMinute: '分',

  appSubtitle: 'Keynote 講稿同步到鏡片',
  connecting: '連線中…',
  connected: '已連上電腦',
  offline: '離線（使用已存講稿）',
  disconnected: '未連線',
  hintNotConnected: '請在電腦上啟動 SlideCue，並確認手機與電腦連著同一個 Wi-Fi。',
  hintRejected: '電腦上的 SlideCue 目前只服務另一台裝置。等一分鐘讓它放開，或在電腦上重新啟動 SlideCue。',
  hintFound: h => `已連上：${h}`,
  hintSearching: list => `找不到電腦。試過：${list}`,
  waitingKeynote: '等待 Keynote 開始播放',
  slideOf: (n, total, notes) => `第 ${n} / ${total} 張　${notes}`,
  noScriptForSlide: '（這張沒有講稿）',

  secCode: '連線碼',
  codePlaceholder: '例如 199',
  codeConnect: '連線',
  codeNote: '輸入電腦上 SlideCue 顯示的三位數。連上一次之後就會記住，換場地才需要重新輸入。',
  codeSearching: c => `正在尋找連線碼 ${c} 的電腦…`,
  codeConnectingTo: h => `正在連線到 ${h}…`,
  codeCleared: '已清除。請輸入電腦上顯示的連線碼。',

  secDeck: '跟哪一份簡報',
  deckAuto: '自動',
  deckAutoNote: '自動：跟著你按下播放的那一份。開了多份簡報又想先確認講稿時，可以在這裡直接指定。',
  deckPinned: n => `已鎖定「${n}」。按播放其他簡報不會自動切走。`,
  deckEmpty: 'Keynote 沒有開著任何簡報',
  deckEmptyNote: '打開 Keynote 並按下播放，講稿就會出現在鏡片上。',
  deckSlides: n => `${n} 張`,
  deckFollowing: n => `目前：${n}`,

  secFollow: '語音跟隨',
  followLabel: '邊念邊讓箭頭自己往下走',
  followNoteOff: '用眼鏡的麥克風聽你念到哪裡。關著的時候，箭頭靠手勢上下滑動。',
  followNoteOn: '眼鏡麥克風已開啟。念稿時箭頭會自己跟著走，手勢仍然可以隨時接手。',
  followError: m => `⚠︎ ${m}。箭頭改用手勢上下滑動。`,
  followMicFailed: '眼鏡麥克風打不開',
  followDownloading: p => `正在下載辨識模型… ${p}%（約 141 MB，只會下載這一次）`,
  followFirstUse: '第一次開啟時會下載辨識模型，約 141 MB。下載完成後才會開始跟隨。',

  secMode: '翻頁方式',
  modeManual: '我自己翻',
  modeRing: 'R1 戒指',
  modeNoteRing: '單擊戒指翻頁，Keynote 會跟著動；Spotlight 或鍵盤也照常能翻。',
  modeNoteManual: '用簡報器或鍵盤翻 Keynote，鏡片上的講稿自動跟上。',

  secDuration: '演講時長',
  durationNote: '用來在鏡片上顯示下課倒數。最後五分鐘會出現進度條。',
  durationOff: '不倒數',
  durationMin: n => `${n} 分`,

  secLang: '語言',
  footer: '講稿與畫面都在鏡片上，這一頁只負責設定。',
}

const en: Strings = {
  lensNow: 'Now',
  lensElapsed: 'Elapsed',
  lensCountdown: 'Time left',
  lensCountdownShort: 'Left',
  lensOvertime: 'Over by',
  lensNoScript: '(no notes on this slide)',
  lensMinute: 'm',

  appSubtitle: 'Keynote notes on your lens',
  connecting: 'Connecting…',
  connected: 'Connected',
  offline: 'Offline (using saved notes)',
  disconnected: 'Not connected',
  hintNotConnected: 'Start SlideCue on your computer, and make sure both are on the same Wi-Fi.',
  hintRejected: 'SlideCue on your computer is serving another device. Wait a minute for it to release, or restart SlideCue on the computer.',
  hintFound: h => `Connected to ${h}`,
  hintSearching: list => `Computer not found. Tried: ${list}`,
  waitingKeynote: 'Waiting for Keynote to start',
  slideOf: (n, total, notes) => `Slide ${n} of ${total}　${notes}`,
  noScriptForSlide: '(no notes)',

  secCode: 'Connection code',
  codePlaceholder: 'e.g. 199',
  codeConnect: 'Connect',
  codeNote: 'Enter the number shown by SlideCue on your computer. It is remembered afterwards — you only need this again at a new venue.',
  codeSearching: c => `Looking for the computer with code ${c}…`,
  codeConnectingTo: h => `Connecting to ${h}…`,
  codeCleared: 'Cleared. Enter the code shown on your computer.',

  secDeck: 'Which presentation',
  deckAuto: 'Automatic',
  deckAutoNote: 'Automatic: follows whichever presentation you start playing. Pick one here if you have several open and want to check the notes first.',
  deckPinned: n => `Locked to “${n}”. Playing another presentation will not switch away.`,
  deckEmpty: 'No presentation open in Keynote',
  deckEmptyNote: 'Open Keynote and press play — your notes will appear on the lens.',
  deckSlides: n => `${n} slides`,
  deckFollowing: n => `Now: ${n}`,

  secFollow: 'Voice Follow',
  followLabel: 'Move the cue arrow as you speak',
  followNoteOff: 'Uses the glasses microphone to track which line you are reading. While off, move the arrow by swiping.',
  followNoteOn: 'Microphone on. The arrow follows as you speak; swiping still takes over at any time.',
  followError: m => `⚠︎ ${m}. Use swipe to move the arrow instead.`,
  followMicFailed: 'Could not open the glasses microphone',
  followDownloading: p => `Downloading the recognition model… ${p}% (about 141 MB, one time only)`,
  followFirstUse: 'The first time you turn this on, a 141 MB recognition model is downloaded. Following starts once it finishes.',

  secMode: 'Slide control',
  modeManual: 'I advance slides',
  modeRing: 'R1 ring',
  modeNoteRing: 'Tap the ring to advance Keynote. Your clicker or keyboard still works too.',
  modeNoteManual: 'Advance Keynote with your clicker or keyboard; the script on the lens follows.',

  secDuration: 'Talk length',
  durationNote: 'Shows a countdown on the lens. A progress bar appears in the final five minutes.',
  durationOff: 'Off',
  durationMin: n => `${n} min`,

  secLang: 'Language',
  footer: 'Your notes appear on the lens. This page is only for settings.',
}

const TABLE: Record<Lang, Strings> = { zh, en }

let current: Lang = 'zh'

export function setLang(l: Lang): void { current = l }
export function getLang(): Lang { return current }
/** 目前語言的字串表。呼叫端每次都重新取，切換語言後才會生效。 */
export function t(): Strings { return TABLE[current] }
