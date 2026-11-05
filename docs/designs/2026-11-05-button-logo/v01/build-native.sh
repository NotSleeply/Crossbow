#!/usr/bin/env bash
# Build only a temporary, separate app. Never install/replace Crossbow.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
PREVIEW_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/crossbow-button-preview.XXXXXX")"
PREVIEW_APP="$PREVIEW_ROOT/Crossbow 主按钮色预览.app"
mkdir -p "$PREVIEW_APP/Contents/MacOS" "$PREVIEW_APP/Contents/Resources"
swiftc -parse-as-library "$ROOT/dock-preview.swift" -o "$PREVIEW_APP/Contents/MacOS/preview"
cp "$ROOT/assets/dock-icon.icns" "$PREVIEW_APP/Contents/Resources/dock-icon.icns"
cp "$ROOT/previews/comparison.png" "$PREVIEW_APP/Contents/Resources/comparison.png"
python3 - "$PREVIEW_APP" <<'PY'
from pathlib import Path
import plistlib,sys
p=Path(sys.argv[1])/'Contents/Info.plist'
p.write_bytes(plistlib.dumps({'CFBundleIdentifier':'dev.crossbow.preview.button-logo','CFBundleName':'Crossbow 主按钮色预览','CFBundleDisplayName':'Crossbow 主按钮色预览','CFBundleExecutable':'preview','CFBundlePackageType':'APPL','CFBundleIconFile':'dock-icon.icns','CFBundleShortVersionString':'1.0','CFBundleVersion':'1','NSHighResolutionCapable':True}))
PY
codesign --force --sign - "$PREVIEW_APP" >/dev/null
printf '%s\n' "$PREVIEW_APP"
