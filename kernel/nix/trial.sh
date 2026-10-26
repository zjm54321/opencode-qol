trial=$(mktemp -d /tmp/opencode-run-XXXXXX)
trap 'rm -rf -- "$trial"' EXIT
trap 'exit 130' INT
trap 'exit 143' HUP TERM
export HOME="$trial/home"
export XDG_CONFIG_HOME="$trial/config"
export XDG_DATA_HOME="$trial/data"
export XDG_STATE_HOME="$trial/state"
export XDG_CACHE_HOME="$trial/cache"
export XDG_RUNTIME_DIR="$trial/runtime"
unset OPENCODE_CONFIG OPENCODE_CONFIG_DIR OPENCODE_CONFIG_CONTENT
mkdir -p "$HOME" "$XDG_CONFIG_HOME" "$XDG_DATA_HOME" "$XDG_STATE_HOME" "$XDG_CACHE_HOME" "$trial/work"
mkdir -m 700 "$XDG_RUNTIME_DIR"
mkdir -p "$XDG_CONFIG_HOME/opencode"
# Keep the trial's CLI connection in-process instead of spawning a persistent service.
printf '{"disabled":true}\n' > "$XDG_CONFIG_HOME/opencode/service.json"
cd "$trial/work"
printf 'OpenCode QoL ephemeral trial: %s (removed on exit)\n' "$trial" >&2
"$OPENCODE_TRIAL_BINARY" "$@"
