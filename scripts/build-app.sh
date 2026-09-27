#!/bin/zsh
# 重建電腦端 SlideCue.app（只換 agent 程式與版本號，Node 與 whisper 沿用上一版 Release 的 app）。
#
# 用法：scripts/build-app.sh <新版本號> [輸出資料夾]
#   例：scripts/build-app.sh 1.2.0 /tmp/slidecue-rel
# 做完後：在另一個 port 煙霧測試 → gh release create v<版本> <輸出>/SlideCue.zip
#
# ⚠️ 版本號要跟 glasses/src/version.ts 的 AGENT_VERSION 一致（agent 回報給眼鏡端比對用）。
# ⚠️ 不要雙擊或直接執行輸出的 app 來測：啟動器會把 launchd 設定改寫成指向這個暫存 app。
#    測試一律用 app 內附的 node 直接跑 agent.js（見最後印出的指令）。
# 原始 app 的完整打包（把 whisper 與 dylib 包進去、install_name_tool、簽章順序）見記憶 project_slidecue_g2_teleprompter.md 2026-08-22 段。
set -euo pipefail
VER="$1"; OUT="${2:-$(mktemp -d)}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
grep -q "AGENT_VERSION = '$VER'" "$ROOT/glasses/src/version.ts" || { echo "version.ts 的 AGENT_VERSION 不是 $VER，先改那裡"; exit 1; }
mkdir -p "$OUT" && cd "$OUT"
gh release download -R agoodbear/slidecue -p SlideCue.zip -O base.zip --clobber
ditto -x -k base.zip base && ditto base/SlideCue.app SlideCue.app
(cd "$ROOT/agent" && npx -y esbuild@0.25 src/index.ts --bundle --platform=node --target=node22 --format=cjs \
   --charset=utf8 --outfile="$OUT/SlideCue.app/Contents/Resources/agent.js" --log-level=warning)   # --charset=utf8：不然中文 log 全變 \uXXXX
plutil -replace CFBundleVersion -string "$VER" SlideCue.app/Contents/Info.plist
plutil -replace CFBundleShortVersionString -string "$VER" SlideCue.app/Contents/Info.plist
# 只動了 Resources 與 Info.plist，內層 node／whisper 的簽章不變；重簽外層（ad-hoc，沒有付費開發者憑證）
codesign --force -s - --identifier com.agoodbear.slidecue.agent SlideCue.app
codesign --verify --deep --strict SlideCue.app
ditto -c -k --sequesterRsrc --keepParent SlideCue.app SlideCue.zip
echo "OK：$OUT/SlideCue.zip"
echo "煙霧測試：SLIDECUE_PORT=8799 SLIDECUE_LOCK_PEER=0 \"$OUT/SlideCue.app/Contents/Resources/node\" \"$OUT/SlideCue.app/Contents/Resources/agent.js\""
echo "  然後 curl localhost:8799/health，並用 ws 連上確認 info.agentVersion=$VER、有 hb 心跳"
