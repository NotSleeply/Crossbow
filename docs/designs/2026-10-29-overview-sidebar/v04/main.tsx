import React from "react";
import { createRoot } from "react-dom/client";
import { UpdateBanner } from "../../../../apps/desktop/src/components/UpdateBanner";
import { setLang } from "../../../../apps/desktop/src/i18n";
import type { UpdateState } from "../../../../apps/desktop/src/ipc";
import "../../../../apps/desktop/src/index.css";
const params = new URLSearchParams(location.search);
if (params.has("en")) setLang("en");
if (params.has("dark")) document.documentElement.classList.add("dark");
const states: UpdateState[] = [
  { version: "0.11.3", notes: null, downloaded: false, progress: null },
  { version: "0.11.3", notes: null, downloaded: false, progress: [58, 100] },
  { version: "0.11.3", notes: null, downloaded: true, progress: null },
];
createRoot(document.getElementById("root")!).render(
  <main style={{ padding: 24, maxWidth: 1000, margin: "0 auto" }}>
    <h1 style={{ fontSize: 18, marginBottom: 24 }}>更新信息条 · 三种状态</h1>
    <p style={{ fontSize: 12, color: "var(--cb-text-dim)", marginBottom: 24 }}>
      正式 UpdateBanner 组件，模拟数据，操作不会下载安装。
    </p>
    {states.map((state, i) => (
      <section key={i} style={{ marginBottom: 24 }}>
        <UpdateBanner update={state} onOpen={() => {}} />
      </section>
    ))}
  </main>,
);
