#!/usr/bin/env bash
set -euo pipefail

version="8.30.1"
install_root="${1:-${XDG_CACHE_HOME:-$HOME/.cache}/careviax/gitleaks/$version}"

case "$(uname -s):$(uname -m)" in
  Linux:x86_64)
    platform="linux_x64"
    checksum="551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb"
    ;;
  Linux:aarch64 | Linux:arm64)
    platform="linux_arm64"
    checksum="e4a487ee7ccd7d3a7f7ec08657610aa3606637dab924210b3aee62570fb4b080"
    ;;
  Darwin:x86_64)
    platform="darwin_x64"
    checksum="dfe101a4db2255fc85120ac7f3d25e4342c3c20cf749f2c20a18081af1952709"
    ;;
  Darwin:arm64)
    platform="darwin_arm64"
    checksum="b40ab0ae55c505963e365f271a8d3846efbc170aa17f2607f13df610a9aeb6a5"
    ;;
  *)
    echo "Unsupported Gitleaks platform: $(uname -s) $(uname -m)" >&2
    exit 1
    ;;
esac

archive="gitleaks_${version}_${platform}.tar.gz"
url="https://github.com/gitleaks/gitleaks/releases/download/v${version}/${archive}"
bin_dir="${install_root}/bin"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

curl --fail --silent --show-error --location "$url" --output "$tmp_dir/$archive"
printf '%s  %s\n' "$checksum" "$tmp_dir/$archive" | shasum -a 256 --check --status
mkdir -p "$bin_dir"
tar -xzf "$tmp_dir/$archive" -C "$bin_dir" gitleaks
chmod 0755 "$bin_dir/gitleaks"

installed_version="$($bin_dir/gitleaks version)"
if [ "$installed_version" != "$version" ]; then
  echo "Installed Gitleaks version did not match $version." >&2
  exit 1
fi

if [ -n "${GITHUB_PATH:-}" ]; then
  printf '%s\n' "$bin_dir" >> "$GITHUB_PATH"
fi

printf 'Installed Gitleaks %s in %s\n' "$version" "$bin_dir"
