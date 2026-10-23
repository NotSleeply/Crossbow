#!/usr/bin/env bash
# Crossbow macOS 发版脚本：构建 → 签名 → 公证 → DMG → latest.json → GitHub Release
#
# 前置条件（一次性）：
#   1. 钥匙串含 "Developer ID Application" 证书（Xcode → Accounts → Manage Certificates）
#   2. 公证凭据已存入钥匙串：
#      xcrun notarytool store-credentials CROSSBOW_NOTARY \
#        --apple-id <AppleID邮箱> --password <App专用密码> --team-id M8H9MSJT3S
#      （App 专用密码：appleid.apple.com → 登录与安全 → App 专用密码 → 生成）
#   3. 更新器签名私钥：~/.tauri/crossbow.key
#   4. gh 已登录
#
# 用法：VERSION=v0.9.2 ./scripts/release-macos.sh
set -euo pipefail

VERSION="${VERSION:?用法: VERSION=v0.9.2 $0}"
VER_NUM="${VERSION#v}"
REPO="Richard-Zhang1019/Crossbow"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_DIR="$ROOT/apps/desktop"
OUT="$ROOT/target/release/bundle"
SIGN_ID="${SIGN_ID:-Developer ID Application: Xueyu Zhang (M8H9MSJT3S)}"
NOTARY_PROFILE="${NOTARY_PROFILE:-CROSSBOW_NOTARY}"

cd "$APP_DIR"

echo "==> 1/7 构建（含更新器签名产物）"
TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/crossbow.key)" \
TAURI_SIGNING_PRIVATE_KEY_PASSWORD="" \
npm run tauri build

echo "==> 2/7 Developer ID 签名 .app（hardened runtime）"
codesign --force --deep --options runtime --sign "$SIGN_ID" "$OUT/macos/Crossbow.app"
codesign -vv "$OUT/macos/Crossbow.app"

echo "==> 3/7 公证 .app 并装订（staple）"
xcrun notarytool submit "$OUT/macos/Crossbow.app.tar.gz" \
  --keychain-profile "$NOTARY_PROFILE" --wait
# tar.gz 是更新器产物，公证对象用 .app 压缩包提交后 staple 到 .app
xcrun stapler staple "$OUT/macos/Crossbow.app"
xcrun stapler validate "$OUT/macos/Crossbow.app"

echo "==> 4/7 制作 DMG 并装订"
DMG="$OUT/dmg/Crossbow_${VER_NUM}_aarch64.dmg"
mkdir -p "$OUT/dmg"
rm -f "$DMG"
hdiutil create -volname Crossbow -srcfolder "$OUT/macos/Crossbow.app" -ov -format UDZO "$DMG"
codesign --force --sign "$SIGN_ID" "$DMG" 2>/dev/null || true
xcrun notarytool submit "$DMG" --keychain-profile "$NOTARY_PROFILE" --wait
xcrun stapler staple "$DMG"

echo "==> 5/7 生成 latest.json（签名取自更新器产物）"
SIG=$(cat "$OUT/macos/Crossbow.app.tar.gz.sig")
NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
NOTES=$(mktemp)
${EDITOR:-vi} "$NOTES"
python3 - "$SIG" "$NOW" "$NOTES" "$VERSION" <<'EOF'
import json, sys
sig, now, notes_file, version = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
notes = open(notes_file).read().strip()
manifest = {
    "version": version.lstrip("v"),
    "notes": notes or f"Crossbow {version}",
    "pub_date": now,
    "platforms": {
        "darwin-aarch64": {
            "signature": sig,
            "url": f"https://github.com/Richard-Zhang1019/Crossbow/releases/download/{version}/Crossbow.app.tar.gz",
        }
    },
}
open("/tmp/latest.json", "w").write(json.dumps(manifest, indent=2, ensure_ascii=False))
EOF

echo "==> 6/7 提交版本号与 tag（若未提交）"
cd "$ROOT"
git add -A && git diff --cached --quiet || git commit -m "chore(release): ${VERSION}"
git tag "${VERSION}" 2>/dev/null || true
git push origin HEAD --follow-tags

echo "==> 7/7 创建 GitHub Release"
gh release create "$VERSION" --repo "$REPO" \
  --title "Crossbow ${VERSION}" --notes-file "$NOTES" \
  "$OUT/macos/Crossbow.app.tar.gz" \
  "$OUT/macos/Crossbow.app.tar.gz.sig" \
  "$DMG" \
  /tmp/latest.json#latest.json

echo "完成：$VERSION 已发布（含 Developer ID 签名 + 公证 + 更新器签名）"
