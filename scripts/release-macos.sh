#!/usr/bin/env bash
# One release implementation: this entry point dispatches the gated CI workflow.
# VERSION=vX.Y.Z bash scripts/release-macos.sh --check     (offline version check)
# VERSION=vX.Y.Z bash scripts/release-macos.sh --dispatch  (existing remote tag)
set -euo pipefail
VERSION="${VERSION:?用法: VERSION=vX.Y.Z bash scripts/release-macos.sh --check|--dispatch}"
MODE="${1:---check}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
if [[ ! "$VERSION" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo '只允许稳定版本 tag vX.Y.Z' >&2
  exit 1
fi
python3 scripts/ci/release_checks.py source --tag "$VERSION"
case "$MODE" in
  --check) echo '版本检查通过；未创建 tag、未推送、未发版。'; exit 0 ;;
  --dispatch) ;;
  *) echo '用法: --check 或 --dispatch' >&2; exit 1 ;;
esac
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo '请先提交工作树改动，确保本地校验对应已提交的源码。' >&2
  exit 1
fi
COMMIT=$(git rev-parse HEAD)
REMOTE=$(git ls-remote origin "refs/tags/$VERSION" "refs/tags/$VERSION^{}")
TAG_COMMIT=$(printf '%s\n' "$REMOTE" | awk -v tag="refs/tags/$VERSION^{}" '$2 == tag {print $1}')
if [ -z "$TAG_COMMIT" ]; then
  TAG_COMMIT=$(printf '%s\n' "$REMOTE" | awk -v tag="refs/tags/$VERSION" '$2 == tag {print $1}')
fi
if [ "$TAG_COMMIT" != "$COMMIT" ]; then
  echo '远端 tag 必须已存在且指向当前 HEAD。请单独审查并推送 tag。' >&2
  exit 1
fi
REPO=Richard-Zhang1019/Crossbow
if gh release view "$VERSION" --repo "$REPO" >/dev/null 2>&1; then
  echo '该版本已发布，拒绝覆盖。' >&2
  exit 1
fi
# Use the workflow at the same immutable tag, never a different branch's version.
gh workflow run release.yml --repo "$REPO" --ref "$VERSION" -f "version=$VERSION"
echo "已请求 CI 发版：$VERSION。请在 GitHub Actions 查看测试、签名、公证与发布结果。"
