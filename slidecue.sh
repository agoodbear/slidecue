#!/usr/bin/env bash
#
# SlideCue 啟停控制。
#
# 上台前跑 `./slidecue.sh up`，它會：
#   1. 偵測 Mac 目前的 IP（換到手機熱點後 IP 會變，這一步不能省）
#   2. 起 Mac agent 與眼鏡端 dev server
#   3. 用「當下這個 IP」產生 QR，掃描即可
#
# 切換網路（例如改用手機熱點）之後，跑 `./slidecue.sh qr` 重產一次即可，
# 不必重啟服務——agent 綁在 0.0.0.0，新網段自動就通。

set -uo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
PORT_AGENT="${SLIDECUE_PORT:-8788}"
PORT_WEB="${SLIDECUE_WEB_PORT:-5173}"
LOG_DIR="$HOME/Library/Logs/slidecue"
mkdir -p "$LOG_DIR"

green() { printf '\033[32m%s\033[0m\n' "$*"; }
red()   { printf '\033[31m%s\033[0m\n' "$*"; }
warn()  { printf '\033[33m%s\033[0m\n' "$*"; }
dim()   { printf '\033[2m%s\033[0m\n' "$*"; }

# ── 找出目前對外的 IP ──────────────────────────────────────────
# 走預設路由的那張介面才是手機連得到的位址。直接抓 en0 在切到
# 手機熱點或 USB 連線時會拿到過期的值。
current_ip() {
  local iface ip
  iface="$(route -n get default 2>/dev/null | awk '/interface:/{print $2}')"
  [ -n "$iface" ] && ip="$(ipconfig getifaddr "$iface" 2>/dev/null)"
  if [ -z "${ip:-}" ]; then
    for i in en0 en1 en2 bridge100; do
      ip="$(ipconfig getifaddr "$i" 2>/dev/null)" && [ -n "$ip" ] && iface="$i" && break
    done
  fi
  [ -n "${ip:-}" ] || return 1
  printf '%s %s' "$ip" "$iface"
}

describe_network() {
  local ip="$1"
  case "$ip" in
    172.20.10.*) echo "iPhone 個人熱點" ;;
    169.254.*)   echo "自我指派位址（沒有真正連上網路）" ;;
    100.*)       echo "Tailscale" ;;
    *)           echo "一般區網" ;;
  esac
}

pid_on_port() { lsof -nP -iTCP:"$1" -sTCP:LISTEN -t 2>/dev/null | head -1; }

# ── up ─────────────────────────────────────────────────────────
cmd_up() {
  local existing
  existing="$(pid_on_port "$PORT_AGENT")"
  if [ -n "$existing" ]; then
    warn "agent 已經在跑（PID ${existing}），略過"
  else
    ( cd "$ROOT/agent" && nohup node --experimental-strip-types src/index.ts \
        > "$LOG_DIR/agent.log" 2>&1 & )
    sleep 2
    if [ -n "$(pid_on_port "$PORT_AGENT")" ]; then
      green "✓ Mac agent 已啟動 :$PORT_AGENT"
    else
      red "✗ agent 起不來，看 $LOG_DIR/agent.log"
      return 1
    fi
  fi

  existing="$(pid_on_port "$PORT_WEB")"
  if [ -n "$existing" ]; then
    warn "dev server 已經在跑（PID ${existing}），略過"
  else
    ( cd "$ROOT/glasses" && nohup npx vite --host --port "$PORT_WEB" \
        > "$LOG_DIR/web.log" 2>&1 & )
    sleep 4
    if [ -n "$(pid_on_port "$PORT_WEB")" ]; then
      green "✓ 眼鏡端 dev server 已啟動 :$PORT_WEB"
    else
      red "✗ dev server 起不來，看 $LOG_DIR/web.log"
      return 1
    fi
  fi

  echo
  cmd_qr
}

# ── qr ─────────────────────────────────────────────────────────
cmd_qr() {
  local info ip iface
  if ! info="$(current_ip)"; then
    red "✗ 找不到可用的 IP。確認 Mac 已連上網路（會場沒 WiFi 就開手機熱點）。"
    return 1
  fi
  ip="${info%% *}"
  iface="${info##* }"

  green "目前位址：$ip  ($iface · $(describe_network "$ip"))"
  if [ -z "$(pid_on_port "$PORT_AGENT")" ]; then
    warn "注意：agent 沒在跑，掃了也連不上。先執行 ./slidecue.sh up"
  fi
  echo
  dim "用 Even app 掃描這個 QR："
  echo
  ( cd "$ROOT/glasses" && npx evenhub qr -i "$ip" -p "$PORT_WEB" )
  echo
  dim "換網路（例如改連手機熱點）之後，重跑 ./slidecue.sh qr 即可，不必重啟服務。"
}

# ── down ───────────────────────────────────────────────────────
cmd_down() {
  local p
  p="$(pid_on_port "$PORT_AGENT")" && [ -n "$p" ] && kill "$p" 2>/dev/null && green "✓ agent 已停止"
  p="$(pid_on_port "$PORT_WEB")"   && [ -n "$p" ] && kill "$p" 2>/dev/null && green "✓ dev server 已停止"
  sleep 1
  [ -z "$(pid_on_port "$PORT_AGENT")" ] && [ -z "$(pid_on_port "$PORT_WEB")" ] \
    && green "✓ 全部關閉" || red "✗ 還有殘留，檢查 lsof -nP -iTCP:$PORT_AGENT,$PORT_WEB"
}

# ── status ─────────────────────────────────────────────────────
cmd_status() {
  local info ip
  if info="$(current_ip)"; then
    ip="${info%% *}"
    echo "位址      $ip  ($(describe_network "$ip"))"
  else
    echo "位址      （沒有可用網路）"
  fi

  local a w
  a="$(pid_on_port "$PORT_AGENT")"
  w="$(pid_on_port "$PORT_WEB")"
  [ -n "$a" ] && green "agent     執行中 (PID $a)  :$PORT_AGENT" || red "agent     未執行"
  [ -n "$w" ] && green "dev       執行中 (PID $w)  :$PORT_WEB"   || red "dev       未執行"

  echo
  dim "最近的 agent 記錄："
  tail -6 "$LOG_DIR/agent.log" 2>/dev/null | grep -viE "experimentalwarning|use .node" | sed 's/^/  /' || true
  return 0
}

case "${1:-up}" in
  up)     cmd_up ;;
  qr)     cmd_qr ;;
  down|stop) cmd_down ;;
  status) cmd_status ;;
  log)    tail -f "$LOG_DIR/agent.log" ;;
  *)
    echo "用法: $0 {up|qr|down|status|log}"
    echo
    echo "  up      起 agent + dev server，並產生 QR"
    echo "  qr      只重產 QR（切換網路後用這個）"
    echo "  down    全部關閉"
    echo "  status  看目前位址與服務狀態"
    echo "  log     持續看 agent 記錄"
    exit 1
    ;;
esac
