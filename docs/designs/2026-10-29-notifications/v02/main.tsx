import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import {
  NotificationProvider,
  NotificationHistory,
} from "../../../../apps/desktop/src/notifications/NotificationProvider";
import { notify } from "../../../../apps/desktop/src/notifications/service";
import { setLang } from "../../../../apps/desktop/src/i18n";
import { repeat, recover, download } from "./mock-tauri";
import "../../../../apps/desktop/src/index.css";
import mark from "../../../../apps/desktop/src/assets/logo-glyph.png";
const query = new URLSearchParams(location.search);
if (query.has("dark")) document.documentElement.classList.add("dark");
if (query.has("en")) setLang("en");
function Demo() {
  const [theme, setTheme] = useState(query.has("dark"));
  const [lang, language] = useState(query.has("en") ? "en" : "zh");
  return (
    <NotificationProvider>
      <header className="cb-demo-header">
        <img src={mark} width={28} height={28} />
        <strong>Crossbow</strong>
        <span>设置</span>
        <div className="cb-global-tools">
          <NotificationHistory />
        </div>
      </header>
      <main className="cb-demo-main">
        <h1>通知系统 · 正式组件</h1>
        <p>
          通知中心使用正式 React
          组件与主题样式。示例数据仅在浏览器内存中，不修改实际设置或网络。
        </p>
        <section>
          <h2>外观</h2>
          <label>
            主题
            <button
              className="cb-btn"
              onClick={() =>
                void notify.run(
                  "setting-theme",
                  "Theme",
                  async () => {
                    setTheme(!theme);
                    document.documentElement.classList.toggle("dark", !theme);
                  },
                  undefined,
                  { feedback: "error-only", titleKey: "settings.theme" },
                )
              }
            >
              {theme ? "深色" : "浅色"}
            </button>
          </label>
          <label>
            语言
            <select
              value={lang}
              onChange={(e) => {
                const next = e.target.value;
                void notify.run(
                  "setting-lang",
                  "Language",
                  async () => {
                    language(next);
                    setLang(next as "zh" | "en");
                  },
                  undefined,
                  { feedback: "error-only", titleKey: "settings.lang" },
                );
              }}
            >
              <option value="zh">中文</option>
              <option value="en">English</option>
            </select>
          </label>
        </section>
        <section>
          <h2>模拟事件</h2>
          <div className="cb-demo-events">
            <button className="cb-btn" onClick={repeat}>
              重复订阅故障
            </button>
            <button className="cb-btn" onClick={recover}>
              TUN 恢复
            </button>
            <button className="cb-btn" onClick={download}>
              下载任务
            </button>
            <button
              className="cb-btn"
              onClick={() =>
                void notify.run(
                  "setting-theme",
                  "Theme",
                  async () => {
                    throw new Error(
                      "Unable to save preference · permission denied",
                    );
                  },
                  undefined,
                  { feedback: "error-only", titleKey: "settings.theme" },
                )
              }
            >
              设置失败
            </button>
          </div>
        </section>
      </main>
    </NotificationProvider>
  );
}
createRoot(document.getElementById("root")!).render(<Demo />);
const style = document.createElement("style");
style.textContent = `.cb-demo-header{display:flex;align-items:center;gap:12px;padding:16px 24px;position:sticky;top:0;background:var(--cb-bg);z-index:10}.cb-demo-header>span{margin-left:32px;color:var(--cb-text-dim);font-size:13px}.cb-demo-header .cb-global-tools{margin-left:auto}.cb-demo-main{padding:36px;max-width:760px}.cb-demo-main h1{font-size:22px;margin:0 0 12px}.cb-demo-main p{font-size:13px;color:var(--cb-text-dim);line-height:1.7}.cb-demo-main section{margin-top:32px}.cb-demo-main h2{font-size:14px}.cb-demo-main label{display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--cb-line);padding:16px 0;font-size:13px}.cb-demo-events{display:flex;gap:10px;flex-wrap:wrap}.cb-demo-main select{background:var(--cb-surface);color:var(--cb-text);padding:6px;border:1px solid var(--cb-line-strong);border-radius:6px}@media(max-width:500px){.cb-demo-main{padding:20px}.cb-demo-header{padding:12px 16px}}`;
document.head.append(style);
