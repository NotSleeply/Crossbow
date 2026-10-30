import React from "react";
import { createRoot } from "react-dom/client";
import Proxies from "../../../../apps/desktop/src/pages/Proxies";
import mark from "../../../../apps/desktop/src/assets/logo-glyph.png";
import { setLang } from "../../../../apps/desktop/src/i18n";
import "../../../../apps/desktop/src/index.css";
import "./preview.css";
const params = new URLSearchParams(location.search);
if (params.has("dark")) document.documentElement.classList.add("dark");
if (params.has("en")) setLang("en");
createRoot(document.getElementById("root")!).render(<div className="cb-frame">
  <header className="preview-header"><img src={mark} width={25} height={25} alt="" /><b>Crossbow</b><nav>概览 <strong>节点</strong> 监测 配置 设置</nav><small>节点工具栏 · 脱敏预览</small></header>
  <main className="cb-paper"><div className="cb-page-content"><Proxies /></div></main>
  <footer className="cb-system-foot"><span>● 运行中 · 模拟数据</span><span>Crossbow · #{227}</span></footer>
</div>);
