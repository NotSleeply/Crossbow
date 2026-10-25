#!/usr/bin/env bash
# Verify what users actually install, then stage exactly the checked bytes.
set -euo pipefail
TAG="${VERSION:?VERSION required}"
APP=target/release/bundle/macos/Crossbow.app
ARCHIVE=target/release/bundle/macos/Crossbow.app.tar.gz
SIGNATURE="$ARCHIVE.sig"
DMG="target/release/bundle/dmg/Crossbow_${TAG#v}_aarch64.dmg"
REPO="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY required}"

# stapler validate 连 Apple GK 票据服务，runner 出口瞬时抖动会让其失败
# （NSURLError -1005 / exit 68）。5 档退避重试规避暂态故障（Refs #102 #104）
staple_validate() {
  local target="$1" attempt
  for attempt in 1 2 3 4 5; do
    if xcrun stapler validate "$target"; then
      return 0
    fi
    echo "stapler validate failed (attempt $attempt/5): $target"
    sleep $((attempt * 20))
  done
  return 1
}

# $2 非空 = 副本（DMG 挂载/解包）：跳过 stapler validate——副本的 staple
# 与主 app 逐字节相同（release_checks.py 已做全量内容比对），重复联网校验
# 只放大 Apple GK 瞬时故障的失败面（Refs #104）
check_signed_app() {
  python3 scripts/ci/release_checks.py app "$1" --tag "$TAG"
  codesign --verify --deep --strict --verbose=2 "$1"
  if [ -z "${2:-}" ]; then
    staple_validate "$1"
  fi
  spctl --assess --type execute --verbose=2 "$1"
  [ "$(lipo -archs "$1/Contents/MacOS/crossbow-desktop")" = arm64 ]
}
check_signed_app "$APP"
codesign --verify --strict --verbose=2 "$DMG"
staple_validate "$DMG"

MOUNT=$(mktemp -d)
UNPACK=$(mktemp -d)
cleanup() {
  hdiutil detach "$MOUNT" -quiet || true
  rmdir "$MOUNT" || true
  rm -rf "$UNPACK"
}
trap cleanup EXIT
hdiutil attach "$DMG" -mountpoint "$MOUNT" -readonly -nobrowse -quiet
check_signed_app "$MOUNT/Crossbow.app" skip-staple
# Match the updater against the app INSIDE the DMG, not just the build folder.
# win 签名等值校验：manifest 的 win64 签名必须与 Windows job 产物一致（Refs #106）
WIN_SIG_FILE=$(ls dist-windows/Crossbow_*_x64-setup.exe.sig 2>/dev/null | head -1 || true)
python3 scripts/ci/release_checks.py updater "$MOUNT/Crossbow.app" --tag "$TAG" \
  --archive "$ARCHIVE" --signature "$SIGNATURE" --manifest latest.json --repo "$REPO" \
  ${WIN_SIG_FILE:+--win-signature "$WIN_SIG_FILE"}
# The updater must independently retain its signature and launch after extraction.
tar -xzf "$ARCHIVE" -C "$UNPACK"
check_signed_app "$UNPACK/Crossbow.app" skip-staple
python3 scripts/ci/smoke_macos.py "$MOUNT/Crossbow.app"
python3 scripts/ci/smoke_macos.py "$UNPACK/Crossbow.app"

mkdir -p dist-release
cp "$DMG" "$ARCHIVE" "$SIGNATURE" latest.json dist-release/
(cd dist-release && shasum -a 256 Crossbow_*.dmg Crossbow.app.tar.gz Crossbow.app.tar.gz.sig latest.json > SHA256SUMS && shasum -a 256 -c SHA256SUMS)
