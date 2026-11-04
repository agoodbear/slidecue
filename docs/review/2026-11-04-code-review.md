# SlideCue 程式碼審查報告（2026-11-04）

- 範圍：`agent/`（電腦端）、`glasses/`（手機／眼鏡端）、`site/`
- 基準 commit：`9c89846`
- 本次修正都在 `claude/gracious-knuth-nge9jw` 分支上
- 依賴稽核原始輸出：[`npm-audit.md`](./npm-audit.md)

## 結論

| # | 嚴重度 | 位置 | 問題 | 狀態 |
|---|---|---|---|---|
| A1 | **高** | `agent/src/keynote.ts`（4 處 `pick`） | `pickDeck` 名稱拼進 AppleScript 前只逸出 `"`、沒逸出 `\`，可以跳出字串字面值，以使用者權限執行任意 AppleScript（含 `do shell script`） | ✅ 已修 |
| A2 | 中 | `agent/src/index.ts` 訊息處理 | WebSocket 訊息沒有驗證型別就直接當 `ControlMessage` 使用（audio 沒有 pcm、sampleRate 是字串、cursorAt 是字串、stats 帶換行） | ✅ 已修 |
| A3 | 中 | `agent/src/index.ts` `ensureModel` | 下載模型時 `WriteStream` 到迴圈結束才掛上 `error` 監聽；中途磁碟滿就會變成未捕捉例外，agent 直接掛掉。也沒有處理背壓 | ✅ 已修 |
| A4 | 中 | `agent/src/index.ts` WS 伺服器 | 沒有檢查 `Origin`。Mac 上的瀏覽器只要開到惡意網頁，就能連 `ws://127.0.0.1:8788`，拿到整份講稿並送控制指令（在 TOFU 鎖定之前，或 `SLIDECUE_LOCK_PEER=0` 時） | ⚠️ 只記錄 |
| A5 | 低 | `agent/src/index.ts` 狀態頁 | 簡報名稱沒有逸出就嵌進 HTML | ✅ 已修 |
| A6 | 低 | `agent/src/index.ts` | `ws` 預設 `maxPayload` 是 100 MiB | ✅ 已修（改為 4 MiB） |
| A7 | 低 | `agent/src/index.ts` `MODEL_URL` | 模型從 Hugging Face `resolve/main` 下載，沒有釘版本、也沒有驗雜湊；這個檔案會交給 C++ 解析 | ⚠️ 只記錄 |
| A8 | 低 | `agent/src/index.ts` `/health` | `Access-Control-Allow-Origin: *`，任何網頁都讀得到簡報名稱與播放狀態（讀不到講稿內容） | ⚠️ 只記錄 |
| G1 | **高** | `glasses/src/main.ts` | 開過語音跟隨之後，啟動時 `setScript()` 會在 `const link` 宣告之前呼叫 `link.send`（TDZ），丟出的錯被 catch 吞掉，**離線快取講稿變成 null** | ✅ 已修 |
| G2 | **高** | `glasses/src/link.ts` `onclose` | 舊連線晚到的 close 事件會把新連線的 `this.ws` 清掉、停掉它的 watchdog，再重連一輪，留下孤兒連線，訊息也會處理兩次 | ✅ 已修 |
| G3 | 中 | `glasses/src/main.ts` `setCursorLine` | `cursor.line` 是字串或小數時會被接受（之後 `cursorLine + 1` 變成字串串接） | ✅ 已修（`Number.isInteger`） |
| G4 | 中 | `glasses/src/main.ts` 頁碼 | 講稿 9–15 行時，捲到底仍顯示「1/2」 | ⚠️ 只記錄 |
| G5 | 中 | `glasses/src/main.ts` `renderStatus` | 手勢後 1 秒 quiet window 內的狀態更新會直接丟掉，事後不補畫（離線指示可能一直不出現） | ⚠️ 只記錄 |
| G6 | 中 | `glasses/src/main.ts` paint | diff 快取在送出之前就寫入；送出失敗不回滾，畫面會卡在錯的內容 | ⚠️ 只記錄 |
| G7 | 中 | `glasses/src/types.ts` `CursorState` | 沒有 `slide` 欄位；換頁後才到的上一輪對齊結果，會把新頁的箭頭拉到舊行號 | ⚠️ 只記錄（要改協定） |
| G8 | 中 | `glasses/src/link.ts` `useCode` | 競速進行中換了連線碼，那一輪不會中止，舊位址仍可能勝出並寫回儲存 | ⚠️ 只記錄 |
| G9 | 中 | `glasses/src/main.ts` | `bundle`／`deck` 訊息沒有結構驗證（`scripts` 不是陣列時，離線翻頁會在手勢 handler 裡丟錯；`elapsedSec` 缺少時顯示「NaN 分」） | ⚠️ 只記錄 |
| G10 | 低 | `glasses/src/phone.ts` | 每次切換語言就多插一個 `<style>`；連線碼 UI 判斷用 `/^\d{1,3}$/`，與 `isShortCode`（1–254）不一致 | ⚠️ 只記錄 |
| G11 | 低 | `glasses/src/host.ts` `normalizeHost` | IPv6 位址（`fe80::1`）結尾的 `:1` 被誤當成埠號 | ⚠️ 只記錄 |
| D1 | 高（僅 dev） | `glasses/package-lock.json` | `vite`、`js-yaml`、`zod`、`source-map-js` 共 4 個 high | ✅ `npm audit fix` 後為 0 |

`site/` 沒有找到缺陷：`innerHTML` 寫入的都是作者寫死的靜態字串。手機端顯示伺服器字串的地方都經過 `escapeHtml` 或 `textContent`，沒有 XSS。

---

## A1　AppleScript 注入（高）

**問題**：`snapshot`、`allNotes`、`showSlide`、`showNextAndRead` 都用同一段程式碼，把手機端送來的 `pickDeck.name` 拼進 osascript：

```ts
if (name of x) is "${pinned.replace(/"/g, '\\"')}" then
```

這段只處理了 `"`。只要名稱裡有反斜線接雙引號，逸出後就會變成 `\\"`。在 AppleScript 裡 `\\` 代表一個字面反斜線，接下來的 `"` 就把字串關掉了，後面的內容會被當成程式碼執行。AppleScript 的 `if … then` 可以省略 `then`，再加上 `--` 註解掉這一行的剩餘部分，就能組出合法的腳本。

**誰能利用**：任何能對 agent 送 WebSocket 訊息的一方，包括：TOFU 鎖定前第一個連上的裝置、`SLIDECUE_LOCK_PEER=0` 時同網段的任何人，以及透過 A4 從 Mac 本機瀏覽器發動的惡意網頁。

**影響**：以使用者權限執行任意指令（`do shell script`）。

**修法**：
1. 新增 `agent/src/applescript.ts` 的 `asString()`：先逸出 `\`，再逸出 `"`。四處重複的 `pick` 收斂成 `keynote.ts` 的 `pickDocument()`。
2. 新增 `isKnownDeck()` 白名單：`pickDeck` 只接受 Keynote 目前真的開著的簡報名稱（手機端本來就是從 `info.documents` 這份清單裡選）。兩道防線，任何一道單獨都能擋下。
3. 附帶修正：檔名本身含反斜線的簡報，以前被點名時會比對失敗，現在可以正確選到。

**驗證**：`agent/tests/security.test.ts` [1] 用 AppleScript 字串字面值的文法（`^"(?:[^"\\]|\\.)*"$`）確認，各種輸入的逸出結果都是「單一個字面值」，而且解回來的內容不變。另外保留一條對照測試，確認舊寫法確實會被打穿。

## A2　控制訊息沒有驗證（中）

`JSON.parse` 的結果被直接當成 `ControlMessage` 使用，實際後果如下：

- `{"type":"audio"}`：`Buffer.from(undefined)` 在 `handleAudio` 的 try 之外丟錯。有 `unhandledRejection` 兜底，所以只會留下一行 log，不會讓 agent 掛掉。
- `sampleRate: "abc"`：這個值被存進全域 `audioSampleRate`，之後每一輪寫 WAV 表頭都會丟錯，語音跟隨整場失效，只能重啟 agent。
- `mode` 可以是任意字串：會被寫進 `timer.json`，也會廣播回眼鏡端。
- `stats.text` 裡的換行原樣寫進 log，可以偽造 log 行。

**修法**：新增 `agent/src/control.ts` 的 `parseControl()`，逐一檢查每種訊息的型別。不合格的回傳 `null` 並丟掉；合格的只保留已知欄位。`sampleRate` 限制為 8000–96000 的整數，`lines` 最多 2000 行，`stats` 去掉換行並截到 500 字。

**驗證**：`security.test.ts` [2]–[4]，其中合法訊息 15 種、不合格 26 種、正規化 4 條。

## A3　模型下載的串流錯誤會讓 agent 掛掉（中）

`createWriteStream` 的 `error` 監聽，原本要到 `out.end()` 之後才掛上。下載途中如果磁碟滿或權限錯誤，`error` 事件發出時沒有監聽者，Node 會把它當成未捕捉例外。`unhandledRejection` 攔不到這種例外，launchd 會重啟 agent。另外，`out.write()` 的回傳值被忽略，網路比磁碟快時資料會一直堆在記憶體裡。

**修法**：一建立串流就掛上 `error` 監聽，每個 chunk 寫入前先檢查有沒有錯誤；`write()` 回傳 false 時，等 `drain` 再繼續。

**驗證**：目前只靠 tsc 與 esbuild 打包確認，沒有做磁碟滿的實測（見「沒做到」）。

## A4　沒有檢查 Origin（中，未修）

瀏覽器允許網頁對任何主機開 WebSocket，包括 `127.0.0.1`，而 agent 不檢查 `Origin`。TOFU 鎖定之前（agent 剛啟動、手機還沒連上），或手機離線超過 60 秒釋放鎖定之後，Mac 上任何一個分頁都能拿走整份講稿，也能送 `control`。修 A1 之前，這條路徑還能直接串成 RCE。

**為什麼沒修**：Even Hub WebView 載入時帶的 Origin 是什麼，在程式碼裡看不出來，必須在真機上確認。貿然加白名單可能讓正式使用者連不上。

**建議**：先在真機上記錄 `req.headers.origin`，再只放行那個值（以及沒有 Origin 的原生連線）。長期還是要照 README 寫的方向，做配對與端到端加密。

## A7　模型完整性（低，未修）

`MODEL_URL` 指向 `resolve/main`，上游一換檔案，使用者下載到的就跟著變。建議改成釘住 commit 的 URL，並在 `renameSync` 前比對 SHA-256。正確的雜湊值要從官方來源取得後寫死；這一輪沒辦法查證，所以沒有改。

## G1　離線快取講稿在開場時被清掉（高）

`main.ts` 的執行順序是：`loadSettings()`（從儲存讀出 `follow = true`）→ `loadCachedBundle()` → `setScript()` → `if (follow) link.send(...)`。但 `const link` 要等到幾行之後才宣告，所以這裡丟出 `ReferenceError`。這個錯被 `loadCachedBundle` 的 catch 吞掉，`bundle` 被設成 `null`。

結果是：講者只要上一場開過語音跟隨，這一場到了沒有網路的會場，鏡片就沒有講稿可顯示。

**修法**：新增 `linkReady` 旗標，在 `link` 建好之後才設為 true；`setScript` 只在 `follow && linkReady` 時送出。原本的 `onConnectedChange` 連上時本來就會補送 `lines`，所以不會漏送。

## G2　舊連線的 onclose 蓋掉新連線（高）

`drop()` 裡有 `this.ws !== ws` 的檢查，`onclose` 卻沒有。iOS 斷網時，close 事件可能晚幾十秒才到；這段期間新連線已經 attach，舊連線的 onclose 一觸發，就把新連線的狀態清掉，接著又重連一輪。

**修法**：`onclose` 開頭加上 `if (this.ws !== ws) return`。對目前使用中的連線，行為不變。

---

## 測試

| 檔案 | 新增或既有 | 內容 |
|---|---|---|
| `agent/tests/security.test.ts` | **新增**，68 條 | AppleScript 逸出、parseControl 合法與不合格訊息、正規化、pickDeck 白名單、HTML 逸出 |
| `agent/tests/listen.test.ts` | **新增**，23 條 | `AudioWindow` 滑動視窗與重疊、緩衝上限、回傳複本；`pcmToWav` 表頭各欄位；`hasSpeech` 門檻邊界 |
| `agent/tests/deck.test.ts` | 既有，18 條 | 全過 |
| `agent/tests/follow.test.ts` | 既有，56 條 | 全過 |
| `glasses/tests/*.ts` | 既有，10 檔 | 全過 |

執行方式：

```bash
cd agent && npx tsc -p . && for f in tests/*.ts; do node --experimental-strip-types "$f" || exit 1; done
cd glasses && node --experimental-strip-types --test tests/*.ts && npm run build
```

### 建議下一輪補的測試（glasses 端，需要先把邏輯抽成純函式）

1. `pageIndicator(pageStart, totalLines, perPage)`：輸入 `(4, 12, 8)` 應得 `2/2`，目前會得 `1/2`（對應 G4）。
2. `buildCandidates('ws://a:8788', '50')`（需先 export）：檢查去重、首選順序，以及 `localhost` 不列入候選。
3. `coarse(NaN)` 應得 `0 分`，目前會得到 `NaN 分`（對應 G9）。
4. `normalizeHost('fe80::1')` 的行為要明確定義（對應 G11）。
5. 整合測試：mock bridge，讓儲存中 `follow='1'` 且有 bundle，啟動後斷言 `bundle !== null`（G1 的回歸測試）。
