#!/usr/bin/env bash
# Verify what users actually install, then stage exactly the checked bytes.
set -euo pipefail
TAG="${VERSION:?VERSION required}"
APP=target/release/bundle/macos/Crossbow.app
ARCHIVE=target/release/bundle/macos/Crossbow.app.tar.gz
SIGNATURE="$ARCHIVE.sig"
DMG="target/release/bundle/dmg/Crossbow_${TAG#v}_aarch64.dmg"
REPO="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY required}"

check_signed_app() {
  python3 scripts/ci/release_checks.py app "$1" --tag "$TAG"
  codesign --verify --deep --strict --verbose=2 "$1"
  xcrun stapler validate "$1"
  spctl --assess --type execute --verbose=2 "$1"
  [ "$(lipo -archs "$1/Contents/MacOS/crossbow-desktop")" = arm64 ]
}
check_signed_app "$APP"
codesign --verify --strict --verbose=2 "$DMG"
xcrun stapler validate "$DMG"

MOUNT=$(mktemp -d)
UNPACK=$(mktemp -d)
cleanup() {
  hdiutil detach "$MOUNT" -quiet || true
  rmdir "$MOUNT" || true
  rm -rf "$UNPACK"
}
trap cleanup EXIT
hdiutil attach "$DMG" -mountpoint "$MOUNT" -readonly -nobrowse -quiet
check_signed_app "$MOUNT/Crossbow.app"
# Match the updater against the app INSIDE the DMG, not just the build folder.
python3 scripts/ci/release_checks.py updater "$MOUNT/Crossbow.app" --tag "$TAG" \
  --archive "$ARCHIVE" --signature "$SIGNATURE" --manifest latest.json --repo "$REPO"
# The updater must independently retain its signature and launch after extraction.
tar -xzf "$ARCHIVE" -C "$UNPACK"
check_signed_app "$UNPACK/Crossbow.app"
python3 scripts/ci/smoke_macos.py "$MOUNT/Crossbow.app"
python3 scripts/ci/smoke_macos.py "$UNPACK/Crossbow.app"

mkdir -p dist-release
cp "$DMG" "$ARCHIVE" "$SIGNATURE" latest.json dist-release/
(cd dist-release && shasum -a 256 Crossbow_*.dmg Crossbow.app.tar.gz Crossbow.app.tar.gz.sig latest.json > SHA256SUMS && shasum -a 256 -c SHA256SUMS)
