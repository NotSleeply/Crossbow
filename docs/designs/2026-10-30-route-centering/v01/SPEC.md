# 连接路径整组居中

2026-10-30 · 已实现 · #227。正式位置 apps/desktop/src/index.css。

| Before | After | Why |
| --- | --- | --- |
| 普通 top24px，紧凑 top18px，对齐图标 | top calc(50% - .5px)，按完整组高度居中 | 图标/节点名称/说明共同构成连接端点 |
| 节点组上对齐 | 节点组垂直居中 | 内容高度变化时仍共享中心线 |

保留单条840ms传输及2560ms间隔。ConnectionFlow原有ResizeObserver测量实际线段，动效轨迹自动跟随，不增加每帧布局测量。

正式组件+正式CSS预览：`apps/desktop/node_modules/.bin/vite --config docs/designs/2026-10-30-route-centering/v01/vite.config.mts`，http://127.0.0.1:5205/ 。只有脱敏模拟流量，不改系统网络。?dark=1为深色。

验证：普通组高104px、紧凑组高79px，两段线中心与整组中心误差均0px，动效轨迹中心亦一致。完整前端构建通过。previews/checks.json保存DOM测量；source.zip冻结源稿。
