# 连接详情垂直对齐补充 v02

日期：2026-11-05。Issue #291 / PR #292。实现 `41ca463`，前置版本 `73d3885`。v01 保留不覆盖。

| Before | After | Why |
| --- | --- | --- |
| 每行标签、值和复制按钮顶部对齐，按钮文字比普通文本低 | 三列按整行垂直居中，文本行高统一 20px | 单行和多行内容的视觉中心一致 |
| 长进程路径换行 | 保留自然换行和完整复制，文本列允许收缩 | 居中调整不丢失详情或挤出按钮 |

正式实现：`apps/desktop/src/index.css` 的 `.cb-connection-details`。源文件快照见 source.zip。沿用 [v01 的生产组件原型](../v01/SPEC.md#编辑与运行)，打开监测→连接→任意连接；模拟数据含长进程路径，支持 `?page=connections&dark=1&en=1`。

验收关注单行目标、两行以上进程路径、明暗主题及小窗口中的标签/值/复制按钮中线。此次为局部 CSS 调整，不新增镜像样式测试；执行前端生产构建。浏览器权限仍有上一轮的明确禁用记录，本轮没有改后截图或宣称视觉验收通过。

## CI 故障分析

旧 run `41866474214` 的 macOS job `126701834927` 没有执行步骤，runner_name 为空。GitHub 注释：`The job was not acquired by Runner of type hosted even after multiple attempts`；另有 macOS arm64 容量不足提示。属于 runner 分配失败，不是本分支编译/测试报错。Linux、pipeline-check、Windows core test 已通过；依赖 macOS 的 build 被跳过。

不为资源队列问题删除 macOS 门禁或修改业务代码。本次提交推送会正常触发新的 PR CI；触发后按用户约定不持续轮询，结果尚未确认。
