#!/bin/bash
set -euo pipefail
repo_dir="$(cd "$(dirname "$0")/../.." && pwd)"
ios_dir="$repo_dir/apps/ios"
mode="${1:---unsigned}"
case "$mode" in
  --unsigned) destination="generic/platform=iOS"; signing=(CODE_SIGNING_ALLOWED=NO); output="unsigned" ;;
  --simulator) destination="generic/platform=iOS Simulator"; signing=(CODE_SIGNING_ALLOWED=NO); output="simulator" ;;
  --device)
    : "${CROSSBOW_DEVICE_ID:?Set CROSSBOW_DEVICE_ID to the paired iPhone UDID}"
    : "${CROSSBOW_TEAM_ID:?Set CROSSBOW_TEAM_ID to your paid developer Team ID}"
    destination="id=$CROSSBOW_DEVICE_ID"; signing=("DEVELOPMENT_TEAM=$CROSSBOW_TEAM_ID" -allowProvisioningUpdates); output="device" ;;
  *) echo "Usage: $0 --unsigned|--simulator|--device" >&2; exit 2 ;;
esac
if [[ ! -d "$ios_dir/Frameworks/Tunnelcore.xcframework" ]]; then
  echo "Missing Tunnelcore.xcframework; run scripts/ios/build-core.sh first." >&2
  exit 1
fi
cd "$ios_dir"
xcodegen generate
xcodebuild -project Crossbow.xcodeproj -scheme Crossbow -configuration Debug \
  -destination "$destination" -derivedDataPath ".build/$output" "${signing[@]}" build
if [[ "$mode" == "--simulator" ]]; then sdk=iphonesimulator; else sdk=iphoneos; fi
bundle=".build/$output/Build/Products/Debug-$sdk/Crossbow.app"
if [[ "$mode" == "--device" ]]; then
  python3 "$repo_dir/scripts/ios/check-bundle.py" "$bundle" --signed
else
  python3 "$repo_dir/scripts/ios/check-bundle.py" "$bundle"
fi
