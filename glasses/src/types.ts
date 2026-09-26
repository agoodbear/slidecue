/**
 * Mac agent 與眼鏡端之間的通訊協定。
 *
 * 這是唯一一份定義，agent 端直接 import 這個檔案，避免兩邊各寫一份而漂移。
 */

/** 誰是「翻頁的發號者」。兩者不能同時當家，否則會互相打架跳頁。 */
export type ControlMode =
  /** R1 戒指主控：眼鏡下令，Keynote 聽命 */
  | 'ring'
  /** 自己翻：Keynote 當家（Spotlight／鍵盤），眼鏡跟著走 */
  | 'manual'

/** Keynote 目前狀態的快照，由 Mac agent 推送。 */
export interface DeckState {
  type: 'deck'
  /** 目前投影片編號，1-based；沒有文件時為 0 */
  slide: number
  /** 簡報總張數 */
  total: number
  /** 該張要顯示的講稿（已套用「空白沿用前一張」規則） */
  notes: string
  /** notes 是沿用自前一張，而非本張自有 */
  inherited: boolean
  /** 在這條繼承鏈中的位置，1-based */
  inheritIndex: number
  /** 這條繼承鏈的總張數 */
  inheritTotal: number
  /** Keynote 是否正在播放 */
  playing: boolean
  /** 簡報檔名，換檔時眼鏡端要重置頁碼 */
  deckName: string
  /**
   * 從開始播放到現在經過的秒數。
   *
   * 刻意由 agent 計算而非眼鏡端自己跑 timer：手機 WebView 進到背景時
   * 系統會節流 setInterval，台上的計時器慢掉是不能接受的。
   * agent 是桌面常駐程式，不受這個限制。
   */
  elapsedSec: number
}

/**
 * 整份講稿，連線建立時推送一次，眼鏡端存起來當離線備援。
 *
 * 存在的理由很實際：演講現場可能完全沒有可用網路，或線鬆了、熱點掉了。
 * 上台不能賭連線，所以事前先把整份帶在身上。
 */
export interface DeckBundle {
  type: 'bundle'
  deckName: string
  total: number
  /** 每張投影片套用繼承規則後的講稿，索引 0 對應第 1 張 */
  scripts: string[]
  /** 與 scripts 對齊的繼承標記 */
  inherited: boolean[]
  inheritIndex: number[]
  inheritTotal: number[]
}

/** agent 對眼鏡端的回應與狀態告知。 */
export interface AgentInfo {
  type: 'info'
  /** Keynote 目前開著哪些簡報，給手機端列出來選。 */
  documents?: Array<{ name: string; slides: number }>
  /** 使用者點名指定的簡報；null 代表自動跟隨最前面／播放中的那一份。 */
  pinnedDeck?: string | null
  /** 現在實際跟著的是哪一份。 */
  activeDeck?: string
  /**
   * 目前跟哪一個 Keynote 對話。
   *
   * 一台 Mac 上可能同時有兩版：`com.apple.Keynote`（Creator Studio，
   * 2026-01 起的現行版）與 `com.apple.iWork.Keynote`（2026-04 已下架的舊版）。
   * 讀不到簡報時，這個值是判斷「是不是問錯 app」的第一線索。
   */
  keynoteApp?: string
  /**
   * 辨識模型的下載進度（0–100）；null 代表沒在下載。
   *
   * 141 MB 不說一聲會讓使用者以為當掉了——第一次開啟語音跟隨時
   * 手機端要看得到這個數字。
   */
  modelDownload?: number | null
  /** 目前生效的翻頁模式 */
  mode: ControlMode
  /** 翻頁實際採用的手段，供除錯顯示 */
  advanceMethod: 'showNext' | 'keystroke' | 'jump' | 'none'
  /** 人類可讀的說明 */
  detail?: string
}

/**
 * 箭頭該移到哪一行。由 Mac 端聽完講者的聲音、對齊講稿之後推過來。
 *
 * 只在「有把握」時才送——對不上的時候什麼都不送，箭頭留在原地。
 * 台上箭頭停著講者還讀得下去，跳到錯的地方會當場斷片。
 */
export interface CursorState {
  type: 'cursor'
  /** 全域行索引（對應眼鏡端斷好的 lines）。 */
  line: number
  /** 這次對齊的相似度，除錯與門檻校準用。 */
  score: number
  /** whisper 這一輪聽到什麼，出問題時要靠它判斷是收音還是對齊的錯。 */
  heard: string
}

/** agent 每 5 秒一次的心跳，讓眼鏡端能自己判斷連線是否已死。 */
export interface Heartbeat {
  type: 'hb'
}

export type AgentMessage = DeckState | AgentInfo | DeckBundle | CursorState | Heartbeat

/** 眼鏡端送回 Mac agent 的指令。 */
export type ControlMessage =
  /** 翻頁（僅 ring 模式生效） */
  | { type: 'control'; action: 'next' | 'prev' }
  /** 要求重送目前狀態 */
  | { type: 'control'; action: 'resync' }
  /** 把計時歸零，重新從現在起算 */
  | { type: 'control'; action: 'resetTimer' }
  /** 設定翻頁模式 */
  | { type: 'mode'; mode: ControlMode }
  /**
   * 眼鏡端把「這張稿被斷成哪幾行」告訴 Mac。
   *
   * 斷行是眼鏡端用實際字寬算的（見 lines.ts），Mac 無從得知。
   * 但語音對齊必須以「行」為單位才能指揮箭頭，所以這份行陣列要送過來。
   */
  | { type: 'lines'; slide: number; lines: string[] }
  /**
   * 眼鏡麥克風收到的一段 PCM，base64 後送給 Mac 轉錄。
   *
   * 走既有的 WebSocket，不另開通道——上台前少一個會壞的東西。
   */
  | { type: 'audio'; pcm: string; sampleRate?: number }
  /** 開關語音跟隨。關掉時 Mac 端會停止轉錄，省電也省 BLE 頻寬。 */
  | { type: 'follow'; on: boolean }
  /**
   * 講者用手勢移動了箭頭。Mac 端的語音對齊要從這裡往前找，
   * 否則下一輪辨識會把箭頭拉回手勢之前的位置。
   */
  | { type: 'cursorAt'; line: number }
  /** 眼鏡端的繪製耗時統計，回報給 Mac 記進 log 以便調校。 */
  | { type: 'stats'; text: string }
  /** 點名要跟哪一份 Keynote；傳 null 代表回到自動。 */
  | { type: 'pickDeck'; name: string | null }
