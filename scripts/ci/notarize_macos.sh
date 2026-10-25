#!/usr/bin/env bash
# Submit one DMG, retain the submission id and fetch Apple's failure details.
set -euo pipefail
DMG="${1:?DMG required}"
DIAGNOSTICS="target/ci-diagnostics"
mkdir -p "$DIAGNOSTICS"
AUTH=(--apple-id "$APPLE_ID" --password "$APPLE_PASSWORD" --team-id "$APPLE_TEAM_ID")
RESULT="$DIAGNOSTICS/notary-submit.json"
STATUS=0
xcrun notarytool submit "$DMG" "${AUTH[@]}" --wait --timeout 30m --output-format json > "$RESULT" || STATUS=$?
cat "$RESULT"
SUBMISSION_ID=$(python3 - "$RESULT" <<'PY'
import json, sys
try:
    print(json.load(open(sys.argv[1])).get('id', ''))
except (ValueError, OSError):
    pass
PY
)
VERDICT=$(python3 - "$RESULT" <<'PY'
import json, sys
try:
    print(json.load(open(sys.argv[1])).get('status', ''))
except (ValueError, OSError):
    pass
PY
)
if [ "$STATUS" -ne 0 ] || [ "$VERDICT" != Accepted ]; then
  if [ -n "$SUBMISSION_ID" ]; then
    xcrun notarytool log "$SUBMISSION_ID" "${AUTH[@]}" > "$DIAGNOSTICS/notary-log.json" || true
    cat "$DIAGNOSTICS/notary-log.json"
  fi
  echo "::error::DMG notarization did not succeed (status=$VERDICT, exit=$STATUS)"
  exit 1
fi
xcrun stapler staple "$DMG"
xcrun stapler validate "$DMG"
