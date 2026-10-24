#!/bin/bash
# Offline macOS escape hatch for a Crossbow TUN test. Run from Terminal or
# double-click in Finder. It never signals a process outside Crossbow's paths.
set -euo pipefail

FALLBACK_PORT="${CROSSBOW_FALLBACK_PORT:-7890}"
FALLBACK_HOST="127.0.0.1"
APP_BINARY="/Applications/Crossbow.app/Contents/MacOS/crossbow-desktop"
TUN_DIRS=(
  "$HOME/Library/Application Support/com.richard.crossbow/tun-binaries"
  "$HOME/Library/Application Support/com.crossbow.app/tun-binaries"
)
MODE="${1:---recover}"

say() { printf '%s\n' "$*"; }
fail() { printf '恢复中止：%s\n' "$*" >&2; exit 1; }

case "$MODE" in
  --check|--recover) ;;
  *) say "用法：$0 [--check|--recover]"; exit 2 ;;
esac
[[ "$(uname -s)" == "Darwin" ]] || fail "此脚本仅适用于 macOS"
[[ "$FALLBACK_PORT" =~ ^[0-9]+$ ]] || fail "备用端口不是有效数字"
(( FALLBACK_PORT >= 1 && FALLBACK_PORT <= 65535 )) || fail "备用端口超出范围"
[[ "$(id -u)" -ne 0 ]] || fail "请以普通用户运行；脚本会在需要时单独请求管理员授权"

is_tun_binary() {
  local binary="$1" root
  for root in "${TUN_DIRS[@]}"; do
    case "$binary" in
      "$root"/*/mihomo|"$root"/*/sing-box) return 0 ;;
    esac
  done
  return 1
}

process_path() {
  /bin/ps -p "$1" -o comm= 2>/dev/null | /usr/bin/sed 's/^[[:space:]]*//'
}

list_crossbow_pids() {
  local kind="$1" pid binary
  while read -r pid binary; do
    [[ "$pid" =~ ^[0-9]+$ ]] || continue
    if [[ "$kind" == "tun" ]]; then
      if is_tun_binary "$binary"; then
        printf '%s\n' "$pid"
      fi
    elif [[ "$binary" == "$APP_BINARY" ]]; then
      printf '%s\n' "$pid"
    fi
  done < <(/bin/ps -axo pid=,comm=)
  return 0
}

tun_routes() {
  /usr/sbin/netstat -rn -f inet | /usr/bin/awk '
    $2 == "198.18.0.1" && $4 ~ /^utun[0-9]+$/ { print $1, $4 }
  '
}

fallback_listening() {
  /usr/bin/nc -z -G 2 "$FALLBACK_HOST" "$FALLBACK_PORT" >/dev/null 2>&1
}

network_service() {
  local interface candidate device
  interface="$(/sbin/route -n get default 2>/dev/null | /usr/bin/awk '$1 == "interface:" { print $2; exit }')" || true
  if [[ -n "$interface" ]]; then
    candidate="$(/usr/sbin/networksetup -listnetworkserviceorder | /usr/bin/awk -v device="$interface" '
      /^\([0-9]+\) / { service = substr($0, index($0, ") ") + 2) }
      index($0, "Device: " device ")") && service != "" { print service; exit }
    ')"
    if [[ -n "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  fi

  # A broken TUN can remove the default route. Fall back to the first enabled
  # hardware service with an active link, in macOS service priority order.
  while IFS=$'\t' read -r candidate device; do
    [[ -n "$candidate" && -n "$device" ]] || continue
    if /sbin/ifconfig "$device" 2>/dev/null | /usr/bin/grep -q 'status: active'; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done < <(/usr/sbin/networksetup -listnetworkserviceorder | /usr/bin/awk '
    /^\([0-9]+\) / { service = substr($0, index($0, ") ") + 2) }
    /Device: / && service != "" {
      device = $0
      sub(/^.*Device: /, "", device)
      sub(/\).*$/, "", device)
      print service "\t" device
    }
  ')
  return 1
}

stop_verified_pid() {
  local pid="$1" kind="$2" binary
  binary="$(process_path "$pid")"
  if [[ "$kind" == "tun" ]]; then
    is_tun_binary "$binary" || fail "PID $pid 的身份已改变，未发送信号"
    sudo /bin/kill -TERM "$pid"
  else
    [[ "$binary" == "$APP_BINARY" ]] || fail "PID $pid 的身份已改变，未发送信号"
    /bin/kill -TERM "$pid"
  fi
}

wait_for_exit() {
  local pid="$1" expected="$2" attempt
  for ((attempt = 0; attempt < 40; attempt++)); do
    [[ "$(process_path "$pid")" == "$expected" ]] || return 0
    /bin/sleep 0.25
  done
  return 1
}

say "Crossbow TUN 离线恢复（备用代理 ${FALLBACK_HOST}:${FALLBACK_PORT}）"
service="$(network_service)" || fail "无法识别当前网络服务；请先连接 Wi-Fi 或有线网络"
[[ -n "$service" && "$service" != \** ]] || fail "当前网络服务不可用"
say "当前网络服务：$service"

app_pids="$(list_crossbow_pids app)"
tun_pids="$(list_crossbow_pids tun)"
routes_before="$(tun_routes)"
if fallback_listening; then
  say "备用代理：本地端口已监听"
else
  say "备用代理：$FALLBACK_HOST:$FALLBACK_PORT 未监听"
fi
say "Crossbow TUN 内核：${tun_pids:-无}"
say "TUN 路由：${routes_before:-无}"

if [[ "$MODE" == "--check" ]]; then
  fallback_listening || fail "请先启动 Clash Verge、关闭其 TUN，并确认混合端口为 $FALLBACK_PORT"
  /usr/bin/curl -fsSI --max-time 10 --proxy "http://$FALLBACK_HOST:$FALLBACK_PORT" https://github.com >/dev/null \
    || fail "备用代理端口已监听，但 GitHub 连通性检查失败"
  say "预检通过；保持 Clash Verge 运行，之后可双击本脚本恢复网络。"
  exit 0
fi

fallback_listening || fail "请先启动 Clash Verge 并让 $FALLBACK_PORT 监听；当前未改动系统设置"
if [[ -z "$tun_pids" && -n "$routes_before" ]]; then
  fail "发现隧道路由但未找到可验证的 Crossbow TUN 内核；为避免误停其他 VPN，未改动网络"
fi

# Get authorization while the current network is still intact. Never stop the
# app first and only then discover that termination or proxy changes are denied.
say "恢复网络需要管理员授权（停止已验证的 Crossbow TUN 内核并设置当前网络服务）。"
sudo -v || fail "未获得管理员授权；未改动系统设置"

if [[ -n "$app_pids" ]]; then
  while IFS= read -r pid; do
    [[ -n "$pid" ]] || continue
    stop_verified_pid "$pid" app
    say "已停止 Crossbow 应用 PID ${pid}，防止它重新拉起 TUN"
  done <<< "$app_pids"
fi

if [[ -n "$tun_pids" ]]; then
  while IFS= read -r pid; do
    [[ -n "$pid" ]] || continue
    binary="$(process_path "$pid")"
    is_tun_binary "$binary" || continue
    stop_verified_pid "$pid" tun
    if ! wait_for_exit "$pid" "$binary"; then
      [[ "$(process_path "$pid")" == "$binary" ]] || continue
      say "TUN 内核 PID $pid 未响应 TERM，发送 KILL"
      sudo /bin/kill -KILL "$pid"
      wait_for_exit "$pid" "$binary" || fail "无法确认 PID $pid 已退出；未切换系统代理"
    fi
  done <<< "$tun_pids"
fi

for ((attempt = 0; attempt < 40; attempt++)); do
  [[ -z "$(tun_routes)" ]] && break
  /bin/sleep 0.25
done
[[ -z "$(tun_routes)" ]] || fail "Crossbow TUN 路由仍存在；未切换系统代理。请在终端检查 netstat -rn -f inet"
fallback_listening || fail "备用代理已退出；未切换系统代理"

sudo /usr/sbin/networksetup -setwebproxy "$service" "$FALLBACK_HOST" "$FALLBACK_PORT"
sudo /usr/sbin/networksetup -setsecurewebproxy "$service" "$FALLBACK_HOST" "$FALLBACK_PORT"
sudo /usr/sbin/networksetup -setsocksfirewallproxy "$service" "$FALLBACK_HOST" "$FALLBACK_PORT"
sudo /usr/sbin/networksetup -setwebproxystate "$service" on
sudo /usr/sbin/networksetup -setsecurewebproxystate "$service" on
sudo /usr/sbin/networksetup -setsocksfirewallproxystate "$service" on

/usr/bin/curl -fsSI --max-time 12 --proxy "http://$FALLBACK_HOST:$FALLBACK_PORT" https://github.com >/dev/null \
  || fail "已切换到备用代理，但 GitHub 连通性检查失败。请检查 Clash Verge 节点。"
say "网络已恢复：$service → Clash Verge ${FALLBACK_HOST}:${FALLBACK_PORT}；Crossbow 应用已退出。"
