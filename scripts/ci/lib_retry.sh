#!/usr/bin/env bash
# Apple GK（api.apple-cloudkit.com）票据服务对 GitHub runner 出口有持续
# 瞬时抖动（NSURLError -1005 / stapler exit 68，Refs #102 #104 #108）。
# 所有 stapler 调用统一经 staple_retry：5 档退避（20-100s），约 5 分钟窗口。
# 用法：staple_retry staple <target> / staple_retry validate <target>
staple_retry() {
  local attempt
  for attempt in 1 2 3 4 5; do
    if xcrun stapler "$@"; then
      return 0
    fi
    echo "stapler $* failed (attempt $attempt/5), backoff $((attempt * 20))s"
    sleep $((attempt * 20))
  done
  echo "::error::stapler $* failed after 5 attempts"
  return 1
}
