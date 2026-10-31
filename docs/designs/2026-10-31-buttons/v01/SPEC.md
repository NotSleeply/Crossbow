# 桌面统一按钮 v01

状态：已实现，待 PR 评审。关联 Issue #231；基线 main `0444f65`。

## 目标与范围

在现有 Crossbow 设计语言上统一操作按钮，保留导航、开关、卡片等控件的语义与布局。两种动作风格为实心 primary 和描边 secondary；顶部使用 toolbar 场景，内容区使用 content 场景。颜色通过现有主题变量跟随明暗模式。

正式实现：`apps/desktop/src/components/Button.tsx`、`Button.css`；用法见同目录 `Button.md`。

| 项目 | 原先 | 本次 |
| --- | --- | --- |
| 动作样式 | 全局类、页面类、内联样式分散 | Button 统一管理实心/描边及危险语义 |
| 顶部/内容 | 尺寸和字色被多个选择器覆盖 | toolbar 34px、content 32px、small 28px |
| 异步状态 | 各处独立 spinner | loading 禁用按钮，保留文案宽度和可访问名称 |
| 特殊控件 | 各处直接创建原生 button | ButtonBase 共享原生语义边界，保留控件自身形态 |

## 交互约定

- hover 使用 140ms 颜色/边框过渡；按压位移 0.5px，100ms；只对精确指针启用 hover。
- 键盘 focus-visible 为 2px 主题轮廓；禁用不可重复触发。
- loading 显示居中转圈，原内容仍占位；750ms 线性旋转。减少动态效果时取消过渡、旋转和按压位移。
- 默认 type=button；表单提交显式使用 submit。ref 和原生事件转发，Select.Trigger 组合继续由 Base UI 管理。
- 页面只管理摆放、业务状态与操作结果，不覆盖按钮高度/填充/hover；通知继续由既有 Notification 服务管理。
- ButtonBase 用于导航、tabs、开关、数据卡片、紧凑通知链接及基础组件组合，不用于另造一套动作样式。

## 迁移与节点回归

15 个使用文件共 35 处 Button、39 处 ButtonBase，桌面手写原生 button 仅保留 ButtonBase 内一处。清除旧 cb-btn 和局部动作按钮的重复绘制规则。

用户预览发现节点单独测速按钮撑坏卡片：共享 position:relative 覆盖了布局工具类。现已把默认定位放入 base 层，并由节点页面明确设置绝对定位及标题右侧避让。6 张卡片在正式编译预览中均为 76px 高；按钮上/右边距测得 7px（含边框），标题距顶部 7px。单节点测速不再挤压文案，也不会误切换节点。

## 验证

- 桌面 TypeScript/Vite 生产构建通过；预览生产构建通过。保留既有大 chunk 提示，无新增构建错误。
- 原生按钮用法约束、网格和国旗测试共 9 项通过。
- 浏览器验证浅/深色 1120×800，以及浅色 820×734，未出现横向溢出；检查 primary hover 对比、loading 宽度和可访问名称、显式表单提交、ref、Select 筛选、对话框和通知锚点。
- 正式编译预览入口为 /assets 下 bundle；该次重载无新增控制台 error/warn。
- 实测记录见 `previews/checks.json`，实际页面见 `previews/production-nodes.jpg`。
- 本次仅为前端组件迁移；未安装正式 App、未在 Windows 原生窗口中验证，也未修改真实代理或网络设置。

## 复现与留存

使用项目已安装的前端依赖和 Node 24（本次验证版本）：

```sh
apps/desktop/node_modules/.bin/vite --config docs/designs/2026-10-31-buttons/v01/vite.config.mts
node --test apps/desktop/src/components/buttonUsage.test.mjs apps/desktop/src/components/fitGrid.test.mjs apps/desktop/src/components/nodeFlags.test.mjs
npm run build --prefix apps/desktop
```

打开本地 5206：默认是真实 App 页面；`?dark=1` 为深色；`?gallery=1` 为按钮状态稿；两参数可组合。预览的 Tauri IPC/事件由内存 mock 替代，仅展示脱敏示例，不调用系统代理。

可编辑原型为 index.html、preview.tsx、preview.css、mock-tauri.ts、vite.config.mts；source.zip 冻结本次桌面源码、构建配置和预览依赖的通知 mock。manifest 保存文件 SHA256；历史设计稿保持不变。
