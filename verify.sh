#!/usr/bin/env bash
#
# SlideCue 環境驗證。
#
# 這支腳本要回答三個問題，它們都必須在「螢幕解鎖」狀態下才測得準
# （macOS 在鎖定時會丟棄合成鍵盤事件，也會讓部分視窗指令失效）：
#
#   1. show next 能不能用？        → 決定 R1 翻頁能不能保住投影片動畫
#   2. 模擬按鍵能不能用？          → show next 不行時的替代方案
#   3. 你用 Spotlight 翻頁時，
#      Keynote 有沒有誠實回報頁碼？ → 決定「自己翻」模式能不能成立
#
# 全程使用拋棄式測試簡報，不會碰到你任何現有檔案。
#
# 用法：bash verify.sh

set -uo pipefail

KEYNOTE='com.apple.iWork.Keynote'
LOG="$(cd "$(dirname "$0")" && pwd)/verify.log"
: > "$LOG"

green() { printf '\033[32m%s\033[0m\n' "$*"; }
red()   { printf '\033[31m%s\033[0m\n' "$*"; }
warn()  { printf '\033[33m%s\033[0m\n' "$*"; }
info()  { printf '%s\n' "$*"; }

osa() { osascript -e "$1" 2>&1; }

# ── 0. 前置檢查 ────────────────────────────────────────────────
info "── SlideCue 環境驗證 ──"
info ""

LOCKED=$(python3 -c "import Quartz;d=Quartz.CGSessionCopyCurrentDictionary();print(bool(d.get('CGSSessionScreenIsLocked')))" 2>/dev/null)
if [ "$LOCKED" = "True" ]; then
  red "✗ 螢幕目前是鎖定狀態，測不準。請解鎖後重跑。"
  exit 1
fi
green "✓ 螢幕已解鎖"

if [ ! -d /Applications/Keynote.app ]; then
  red "✗ 找不到 /Applications/Keynote.app"
  exit 1
fi
KV=$(osa 'tell application id "'"$KEYNOTE"'" to return version')
green "✓ Keynote ${KV}（用 bundle id 定址，不會被 Keynote Creator Studio 攔走）"
info ""

# ── 1. 建立拋棄式測試簡報 ──────────────────────────────────────
info "建立測試簡報（5 張，用完自動刪除）…"
osa '
tell application id "'"$KEYNOTE"'"
	activate
	repeat while (count of documents) > 0
		close front document saving no
	end repeat
	set d to make new document
	tell d
		repeat 4 times
			make new slide at end
		end repeat
		tell slide 1 to make new text item with properties {object text:"第 1 張　請按一下 Spotlight 的下一頁"}
		tell slide 2 to make new text item with properties {object text:"第 2 張　很好，再按一次"}
		tell slide 3 to make new text item with properties {object text:"第 3 張　再按一次"}
		tell slide 4 to make new text item with properties {object text:"第 4 張　最後一次"}
		tell slide 5 to make new text item with properties {object text:"第 5 張　完成了，請按 Esc 結束"}
		set presenter notes of slide 1 to "NOTE-1"
		set presenter notes of slide 2 to "NOTE-2"
		set presenter notes of slide 3 to "NOTE-3"
		set presenter notes of slide 4 to "NOTE-4"
		set presenter notes of slide 5 to "NOTE-5"
	end tell
end tell' > /dev/null
green "✓ 測試簡報已建立"
info ""

read_slide() {
  osa 'tell application id "'"$KEYNOTE"'"
    if (count of documents) is 0 then return "0"
    return (slide number of current slide of front document) as text
  end tell'
}

# ── 2. 自動測：show next 與模擬按鍵 ────────────────────────────
info "【自動測試】播放中測兩種翻頁指令（約 15 秒，畫面會全螢幕）…"
osa 'tell application id "'"$KEYNOTE"'"
  set d to front document
  start d from slide 1 of d
end tell' > /dev/null
sleep 3

BEFORE=$(read_slide)
echo "自動測試起始頁: $BEFORE" >> "$LOG"

# 2a. show next
SHOWNEXT_ERR=$(osa 'tell application id "'"$KEYNOTE"'" to show next')
sleep 1
AFTER_SN=$(read_slide)
echo "show next -> $AFTER_SN (err: $SHOWNEXT_ERR)" >> "$LOG"

if [ "$AFTER_SN" -gt "$BEFORE" ] 2>/dev/null; then
  SHOWNEXT_OK=1
else
  SHOWNEXT_OK=0
fi

# 回到第 1 張再測按鍵
osa 'tell application id "'"$KEYNOTE"'" to show slide 1 of front document' > /dev/null
sleep 1
BEFORE2=$(read_slide)

# 2b. 模擬右方向鍵
KEY_ERR=$(osa 'tell application "System Events" to tell process "Keynote" to key code 124')
sleep 1
AFTER_KEY=$(read_slide)
echo "keystroke -> $AFTER_KEY (from $BEFORE2, err: $KEY_ERR)" >> "$LOG"

if [ "$AFTER_KEY" -gt "$BEFORE2" ] 2>/dev/null; then
  KEY_OK=1
else
  KEY_OK=0
fi

# ── 3. 人工測：Spotlight 翻頁時頁碼是否誠實回報 ────────────────
osa 'tell application id "'"$KEYNOTE"'" to show slide 1 of front document' > /dev/null
sleep 1

info ""
warn "【人工測試】接下來請照畫面上的指示，用 Spotlight 按 4 次下一頁，然後按 Esc。"
warn "（指示就寫在投影片上，全螢幕也看得到）"
info ""
info "3 秒後開始記錄…"
sleep 3

SEEN=""
LAST=""
for i in $(seq 1 150); do   # 150 x 0.4s = 60 秒
  S=$(read_slide)
  if [ "$S" != "$LAST" ]; then
    echo "$(date +%H:%M:%S) 頁碼 -> $S" >> "$LOG"
    SEEN="$SEEN $S"
    LAST="$S"
  fi
  # 播放結束就提早收工
  P=$(osa 'tell application id "'"$KEYNOTE"'"
    if (count of documents) is 0 then return "false"
    return (playing as text)
  end tell')
  [ "$P" = "false" ] && break
  sleep 0.4
done

UNIQ=$(echo "$SEEN" | tr ' ' '\n' | grep -v '^$' | uniq | tr '\n' ' ')
CHANGES=$(echo "$SEEN" | tr ' ' '\n' | grep -v '^$' | uniq | wc -l | tr -d ' ')

# ── 4. 清理 ────────────────────────────────────────────────────
osa 'tell application id "'"$KEYNOTE"'"
  try
    stop front document
  end try
  delay 1
  repeat while (count of documents) > 0
    close front document saving no
  end repeat' > /dev/null

# ── 5. 報告 ────────────────────────────────────────────────────
info ""
info "════════ 驗證結果 ════════"
info ""

if [ "$SHOWNEXT_OK" = "1" ]; then
  green "✓ show next 可用 → R1 翻頁會保留投影片動畫（最理想）"
else
  warn "✗ show next 不可用（${SHOWNEXT_ERR}）"
fi

if [ "$KEY_OK" = "1" ]; then
  green "✓ 模擬按鍵可用 → 可作為保留動畫的備援手段"
else
  warn "✗ 模擬按鍵不可用（可能要到「系統設定 → 隱私權與安全性 → 輔助使用」授權終端機）"
fi

info ""
if [ "$CHANGES" -ge 3 ]; then
  green "✓ 手動翻頁時 Keynote 有誠實回報頁碼"
  info "   實際觀測到的頁碼序列：$UNIQ"
  info "   → 「自己翻（Spotlight／鍵盤）」模式成立，可以直接用"
elif [ "$CHANGES" -ge 2 ]; then
  warn "△ 只觀測到 $CHANGES 次頁碼變化：$UNIQ"
  info "   如果你確實按了 4 次，代表回報有遺漏，需要改用鍵盤事件攔截"
else
  red "✗ 沒觀測到頁碼變化（${UNIQ}）"
  info "   如果你確實有按，代表 Keynote 在播放中不更新 current slide，"
  info "   「自己翻」模式必須改成攔截鍵盤事件自行計數。"
fi

info ""
info "詳細記錄：$LOG"
