#!/usr/bin/env bash
#
# 把 SlideCue agent 註冊成開機自動啟動。
#
# 裝了之後就不必再開終端機——開 Keynote 按播放，鏡片上就有講稿。
# 這是「兩步驟」目標的最後一塊。
#
# 用法：
#   bash install-autostart.sh          安裝並立即啟動
#   bash install-autostart.sh remove   移除
#   bash install-autostart.sh status   看狀態

set -uo pipefail

LABEL="com.agoodbear.slidecue.agent"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NODE="$(command -v node)"
LOG_DIR="$HOME/Library/Logs/slidecue"

# ── 這台電腦的位址 ────────────────────────────────────────────
# 手機端多數時候會自動找到，但換到陌生網路、或路由器擋住裝置互連時
# 就得手動填。那時候使用者需要的是一個看得懂、抄得下來的字串。
show_address() {
  local mdns ip iface
  mdns="$(scutil --get LocalHostName 2>/dev/null)"
  iface="$(route -n get default 2>/dev/null | awk '/interface:/{print $2}')"
  [ -n "$iface" ] && ip="$(ipconfig getifaddr "$iface" 2>/dev/null)"

  info "  ── 如果手機找不到這台電腦，在 SlideCue 的「電腦」欄填這個 ──"
  [ -n "$mdns" ] && green "     ${mdns}.local"
  if [ -n "${ip:-}" ]; then
    info "     或者：${ip}"
  fi
  info ""
  info "  （換 Wi-Fi 或改用手機熱點之後，上面的 IP 會變，"
  info "    但 .local 那個不會，優先用它。）"
  info ""
}

green() { printf '\033[32m%s\033[0m\n' "$*"; }
red()   { printf '\033[31m%s\033[0m\n' "$*"; }
info()  { printf '%s\n' "$*"; }

case "${1:-install}" in

  install)
    [ -n "$NODE" ] || { red "✗ 找不到 node"; exit 1; }
    mkdir -p "$LOG_DIR" "$HOME/Library/LaunchAgents"

    # 已經在跑就先停掉，避免兩個 agent 搶同一個 port
    launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null

    cat > "$PLIST" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>

  <key>ProgramArguments</key>
  <array>
    <string>${NODE}</string>
    <string>--experimental-strip-types</string>
    <string>${ROOT}/agent/src/index.ts</string>
  </array>

  <key>WorkingDirectory</key>
  <string>${ROOT}/agent</string>

  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>

  <key>StandardOutPath</key>
  <string>${LOG_DIR}/agent.log</string>
  <key>StandardErrorPath</key>
  <string>${LOG_DIR}/agent.log</string>
</dict>
</plist>
PLIST_EOF

    launchctl bootstrap "gui/$(id -u)" "$PLIST" 2>/dev/null || launchctl load "$PLIST" 2>/dev/null
    sleep 3

    if lsof -nP -iTCP:8788 -sTCP:LISTEN -t >/dev/null 2>&1; then
      green "✓ SlideCue 已設為開機自動啟動，而且現在就在跑"
      info ""
      info "  從現在起你只要做兩件事："
      info "    1. 開 Keynote 按播放"
      info "    2. 戴上眼鏡開 SlideCue"
      info ""
      # 手機通常會自動找到這台電腦；找不到時使用者需要一個
      # 「可以照著打」的東西，所以這裡把位址講清楚而不是埋在 log 裡。
      show_address
      info "  記錄檔：${LOG_DIR}/agent.log"
      info "  要移除：bash $(basename "$0") remove"
    else
      red "✗ 沒有成功監聽 :8788，看記錄檔：${LOG_DIR}/agent.log"
      tail -5 "${LOG_DIR}/agent.log" 2>/dev/null
      exit 1
    fi
    ;;

  remove)
    launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null || launchctl unload "$PLIST" 2>/dev/null
    rm -f "$PLIST"
    green "✓ 已移除開機自動啟動"
    ;;

  status)
    if launchctl print "gui/$(id -u)/${LABEL}" >/dev/null 2>&1; then
      green "✓ 已註冊開機自動啟動"
    else
      info "未註冊開機自動啟動"
    fi
    if lsof -nP -iTCP:8788 -sTCP:LISTEN -t >/dev/null 2>&1; then
      green "✓ agent 正在執行 :8788"
    else
      red "✗ agent 沒有在跑"
    fi
    echo
    show_address
    info "最近的記錄："
    tail -6 "${LOG_DIR}/agent.log" 2>/dev/null | grep -viE "experimentalwarning|use .node" | sed 's/^/  /'
    ;;

  *)
    echo "用法: $0 {install|remove|status}"
    exit 1
    ;;
esac
