#!/bin/bash
set -euo pipefail
repo_dir="$(cd "$(dirname "$0")/../.." && pwd)"
core_dir="$repo_dir/apps/ios/TunnelCore"
output_dir="$repo_dir/apps/ios/Frameworks"
export GOTOOLCHAIN="${GOTOOLCHAIN:-local}"
export PATH="$(go env GOPATH)/bin:$PATH"
go install github.com/sagernet/gomobile/cmd/gomobile@v0.1.12
go install github.com/sagernet/gomobile/cmd/gobind@v0.1.12
mkdir -p "$output_dir"
cd "$core_dir"
gomobile bind -v -target="${CROSSBOW_APPLE_TARGETS:-ios,iossimulator}" \
  -iosversion=17.0 -o "$output_dir/Tunnelcore.xcframework" \
  -trimpath -ldflags='-s -w -X github.com/sagernet/sing-box/constant.Version=1.14.4' \
  -tags=with_gvisor,with_quic,with_utls,with_clash_api,with_low_memory .
