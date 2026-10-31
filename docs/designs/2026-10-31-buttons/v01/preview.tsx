import React, { useState, useRef } from "react";
import { createRoot } from "react-dom/client";
import App from "../../../../apps/desktop/src/App";
import { NotificationProvider } from "../../../../apps/desktop/src/notifications/NotificationProvider";
import {
  Button,
  ButtonBase,
} from "../../../../apps/desktop/src/components/Button";
import { Icon } from "../../../../apps/desktop/src/components/Icon";
import "../../../../apps/desktop/src/index.css";
import "./preview.css";
const params = new URLSearchParams(location.search);
if (params.has("dark")) document.documentElement.classList.add("dark");
function Buttons() {
  const [busy, setBusy] = useState(false),
    [clicks, setClicks] = useState(0),
    [submits, setSubmits] = useState(0);
  const ref = useRef<HTMLButtonElement>(null);
  const load = () => {
    setBusy(true);
    setClicks((n) => n + 1);
    setTimeout(() => setBusy(false), 1800);
  };
  return (
    <main className="button-demo">
      <header>
        <h1>Crossbow · 公共按钮</h1>
        <p>实心 / 描边 · 顶部与内容区 · 正式组件</p>
      </header>
      <section className="button-demo-chrome">
        <h2>顶部工具栏 · 34px</h2>
        <div>
          <Button context="toolbar">
            <span>my-nodes · 当前配置</span>
            <Icon name="chevron" />
          </Button>
          <Button context="toolbar">
            <Icon name="pulse" />
            诊断
          </Button>
          <Button context="toolbar" iconOnly aria-label="最近通知">
            <Icon name="bell" size={18} />
          </Button>
          <Button context="toolbar" variant="primary">
            主要操作
          </Button>
        </div>
      </section>
      <section>
        <h2>内容区 · 32px</h2>
        <div>
          <Button variant="primary">
            <Icon name="bolt" />
            选择节点
          </Button>
          <Button>
            <Icon name="cube" />
            查看连接
          </Button>
          <Button>重命名</Button>
          <Button>
            <Icon name="download" />
            导入配置
          </Button>
          <Button tone="danger">删除</Button>
          <Button iconOnly aria-label="刷新">
            <Icon name="refresh" />
          </Button>
        </div>
      </section>
      <section>
        <h2>状态与紧凑尺寸</h2>
        <div>
          <Button variant="primary" disabled>
            主按钮禁用
          </Button>
          <Button disabled>次按钮禁用</Button>
          <Button variant="primary" loading>
            加载中
          </Button>
          <Button loading>保存中</Button>
          <Button size="small">小按钮</Button>
          <Button size="small" iconOnly aria-label="关闭">
            <Icon name="check" />
          </Button>
        </div>
      </section>
      <section>
        <h2>交互验证</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setSubmits((n) => n + 1);
          }}
        >
          <Button ref={ref} onClick={() => setClicks((n) => n + 1)}>
            默认不提交表单
          </Button>
          <Button type="submit">提交表单</Button>
          <Button
            variant="primary"
            loading={busy}
            onClick={load}
            data-testid="async-button"
          >
            执行异步操作
          </Button>
          <Button onClick={() => ref.current?.focus()}>聚焦第一个按钮</Button>
        </form>
        <p role="status">
          点击 {clicks} 次 · 提交 {submits} 次
        </p>
      </section>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(
  params.has("gallery") ? (
    <Buttons />
  ) : (
    <NotificationProvider>
      <App />
    </NotificationProvider>
  ),
);
