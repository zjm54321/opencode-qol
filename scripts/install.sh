#!/usr/bin/env bash
set -euo pipefail

version=latest
archive=
install_dir="${HOME}/.opencode/bin"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --version|--archive|--install-dir)
      [[ $# -ge 2 ]] || { printf 'Missing value for %s\n' "$1" >&2; exit 1; }
      case "$1" in
        --version) version=$2 ;;
        --archive) archive=$2 ;;
        --install-dir) install_dir=$2 ;;
      esac
      shift 2 ;;
    -h|--help)
      printf 'Usage: bash install.sh [--version TAG] [--archive FILE] [--install-dir DIR]\nLinux releases contain a Nix closure and require Nix. macOS requires a separately published native archive.\n'
      exit 0 ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; exit 1 ;;
  esac
done
case "$(uname -s)" in
  Linux) platform=linux ;;
  Darwin) platform=darwin ;;
  *) printf 'Unsupported system: %s\n' "$(uname -s)" >&2; exit 1 ;;
esac
case "$(uname -m)" in
  x86_64|amd64) arch=x64 ;;
  arm64|aarch64) arch=arm64 ;;
  *) printf 'Unsupported architecture: %s\n' "$(uname -m)" >&2; exit 1 ;;
esac
tmp_dir=$(mktemp -d "${TMPDIR:-/tmp}/opencode-qol.XXXXXXXX")
trap 'rm -rf -- "$tmp_dir"' EXIT
if [[ -z "$archive" ]]; then
  base=https://github.com/zjm54321/opencode-qol/releases
  if [[ "$version" == latest ]]; then
    url="$base/latest/download/opencode-$platform-$arch.tar.gz"
  else
    url="$base/download/$version/opencode-$platform-$arch.tar.gz"
  fi
  archive="$tmp_dir/opencode.tar.gz"
  printf 'Downloading OpenCode QoL (%s, %s-%s)...\n' "$version" "$platform" "$arch"
  if command -v curl >/dev/null 2>&1; then
    curl --fail --location --retry 3 --output "$archive" "$url"
  elif command -v wget >/dev/null 2>&1; then
    wget -O "$archive" "$url"
  else
    printf 'Install curl or wget to download releases.\n' >&2; exit 1
  fi
fi
mkdir -p "$tmp_dir/unpacked" "$install_dir"
install_dir=$(cd "$install_dir" && pwd)
tar -xzf "$archive" -C "$tmp_dir/unpacked"
if [[ -f "$tmp_dir/unpacked/closure.nar" ]]; then
  command -v nix-store >/dev/null 2>&1 || { printf 'This Linux release requires Nix. Install Nix, then rerun this script.\n' >&2; exit 1; }
  store_path=$(<"$tmp_dir/unpacked/store-path")
  [[ "$store_path" == /nix/store/* && "$store_path" != *$'\n'* ]] || { printf 'Invalid Nix package path.\n' >&2; exit 1; }
  nix-store --import < "$tmp_dir/unpacked/closure.nar" >/dev/null
  nix-store --realise "$store_path" --add-root "$install_dir/.opencode-qol-root" --indirect >/dev/null
  ln -sfn "$store_path/bin/opencode" "$install_dir/opencode"
else
  [[ -f "$tmp_dir/unpacked/opencode" ]] || { printf 'Archive does not contain opencode.\n' >&2; exit 1; }
  cp -R "$tmp_dir/unpacked/." "$install_dir/"
  chmod +x "$install_dir/opencode"
fi
"$install_dir/opencode" --version
printf 'OpenCode QoL installed: %s/opencode\n' "$install_dir"
case ":${PATH}:" in
  *":${install_dir}:"*) ;;
  *) printf 'Add this directory to your shell PATH:\n  export PATH="%s:$PATH"\n' "$install_dir" ;;
esac
