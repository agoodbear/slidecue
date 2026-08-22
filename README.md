# SlideCue

把 Keynote 的講者附註顯示在 [Even Realities G2](https://www.evenrealities.com/) 鏡片上，翻頁自動換稿。

📖 **[安裝與使用說明](https://slidecue.pages.dev/)**（含互動示範）

---

## 這是什麼

上台時低頭看稿會斷掉與聽眾的眼神接觸，而把稿子放在筆電上又要一直轉頭。
SlideCue 讓講稿浮在你正前方——**看起來像懸在兩公尺外的一塊字幕，不會擋住聽眾的臉**。

- 翻 Keynote，鏡片上的講稿自動跟上
- 左側箭頭標示你正在念的那一行
- 上方顯示現在時刻、已講多久、離結束還剩多久
- **語音跟隨**（選用）：用眼鏡的麥克風辨識你念到哪一行，箭頭自己往下走
- 斷線不中斷：整份講稿事前已存進手機

## 兩個部分

| | 跑在哪 | 做什麼 |
|---|---|---|
| **電腦端** | 你的 Mac，背景常駐 | 讀 Keynote 目前播到第幾張、那張的講稿，透過區域網路送出 |
| **手機端** | 手機（從 Even Hub 安裝） | 收到之後畫在鏡片上 |

眼鏡和手機都看不到你的 Keynote——只有跑在 Mac 上的程式能問 macOS
「現在播到第幾張」。所以電腦端不是選配。

## 安裝

一般使用者請看 **[安裝說明](https://slidecue.pages.dev/)**，
或直接到 [Releases](../../releases) 下載 `SlideCue.zip`。

電腦端內含執行所需的一切（Node.js 執行環境與語音辨識引擎），
**不必另外安裝 Homebrew、Node.js 或任何開發工具**。

## 系統需求

- macOS 13 或更新（Apple Silicon 與 Intel 皆可）
- Keynote（2026 起的 Creator Studio 版與舊版皆支援，會自動偵測）
- Even Realities G2 與 Even Hub app
- 手機與 Mac 連在同一個區域網路

## ⚠️ 安全性：目前的限制

**電腦端沒有身分驗證。** 連上 `:8788` 的裝置會直接收到整份講稿。

目前的緩解是「只服務第一個連上的裝置」（Trust On First Use），**預設開啟**，
其他裝置一律拒絕；斷線滿 60 秒才釋放，換 Wi-Fi 時不會把你鎖在門外。

```bash
SLIDECUE_LOCK_PEER=0   # 關閉（多支手機輪流連同一台電腦時才需要）
```

**根本的修法是配對加上端到端加密，尚未實作。**
在此之前，如果你的講稿內容敏感，在公共 Wi-Fi 上演講時請勿關閉裝置鎖定，
或改用手機個人熱點。

## 開發

```bash
# 電腦端
cd agent && npm install && npm run dev

# 手機／眼鏡端
cd glasses && npm install && npm run dev
npx evenhub-simulator --no-glow "http://<你的區網 IP>:5173"

# 測試
cd glasses && node --experimental-strip-types --test tests/*.ts
```

環境變數：

| 變數 | 用途 |
|---|---|
| `SLIDECUE_PORT` | 電腦端監聽的埠號（預設 8788） |
| `SLIDECUE_LOCK_PEER` | 設 `0` 關閉裝置鎖定 |
| `SLIDECUE_WHISPER_MODEL` | 指定語音辨識模型（預設自動下載 `ggml-base.bin`） |
| `SLIDECUE_WHISPER` | 指定已在執行的 whisper-server 位址 |

## 語音辨識

第一次開啟語音跟隨時，會下載約 141 MB 的辨識模型到
`~/Library/Application Support/SlideCue/models/`，之後完全在本機執行。

用 `base` 而不是更大的模型，是實測後的決定：比較 `base`(141MB)、
`small`(465MB)、`large-v3-turbo`(1549MB) 三者，**對齊分數完全相同**，
而 `base` 最快。原因是這裡做的是「強制對齊」而非開放辨識——
整份講稿已當成 prompt 餵給模型，它只需要認出講者念到哪。

## 隱私

講稿只在你自己的 Mac、手機與眼鏡之間傳遞，**不經過任何伺服器**。
語音辨識完全在你自己的電腦上執行，不上傳雲端，不保留錄音。
完整說明見[隱私權政策](https://slidecue.pages.dev/#privacy)。

## 致謝

語音辨識使用 [whisper.cpp](https://github.com/ggml-org/whisper.cpp)
（MIT License, Copyright © 2023-2026 The ggml authors）。

SlideCue 與 Apple Inc. 及 Even Realities 均無隸屬關係。
Keynote 是 Apple Inc. 的商標。
