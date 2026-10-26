#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"
CONFIG_DIR="$REPO_DIR/isolated/config"
DATA_DIR="/tmp/opencode-isolated/data"
STATE_DIR="/tmp/opencode-isolated/state"
CACHE_DIR="/tmp/opencode-isolated/cache"
OPENCODE_BIN="$(nix build "$REPO_DIR#kernel" --no-link --print-out-paths)/bin/opencode"

mkdir -p "$DATA_DIR" "$STATE_DIR" "$CACHE_DIR"

# Seed history once from production; all subsequent writes target this private copy.
if [ -f "$HOME/.local/share/opencode/opencode.db" ] && [ ! -e "$DATA_DIR/opencode/opencode.db" ]; then
  mkdir -p "$DATA_DIR/opencode"
  cp -- "$HOME/.local/share/opencode/opencode.db"* "$DATA_DIR/opencode/"
fi

# 检查首个参数是否为特定子命令；若是普通运行（TUI）则自动附加 --standalone 保证完全独立
subcommands="upgrade update uninstall acp api debug auth mcp plugin models stats mini run session service reload pair serve"
is_subcommand=false
if [ $# -gt 0 ]; then
  for sc in $subcommands; do
    if [ "$1" = "$sc" ]; then
      is_subcommand=true
      break
    fi
  done
fi

echo "=================================================="
echo " 正在以【独立隔离模式】启动 OpenCode v2.1.4-qol"
echo " 配置文件: $CONFIG_DIR/opencode/opencode.json"
echo " 数据目录: $DATA_DIR (独立临时目录，避免快照递归膨胀)"
echo " 服务模式: 独立本地进程 (--standalone)"
echo "=================================================="

if [ "$is_subcommand" = true ]; then
  # Model validation must load this build/config, not a previously started service.
  if [ "$1" = models ]; then
    set -- "$@" --standalone
  fi
  exec env \
    XDG_DATA_HOME="$DATA_DIR" \
    XDG_CONFIG_HOME="$CONFIG_DIR" \
    XDG_STATE_HOME="$STATE_DIR" \
    XDG_CACHE_HOME="$CACHE_DIR" \
    "$OPENCODE_BIN" "$@"
else
  exec env \
    XDG_DATA_HOME="$DATA_DIR" \
    XDG_CONFIG_HOME="$CONFIG_DIR" \
    XDG_STATE_HOME="$STATE_DIR" \
    XDG_CACHE_HOME="$CACHE_DIR" \
    "$OPENCODE_BIN" --standalone "$@"
fi
