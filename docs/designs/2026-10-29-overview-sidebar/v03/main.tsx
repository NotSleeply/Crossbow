import React from "react";
import { createRoot } from "react-dom/client";
import HomePage from "../../../../apps/desktop/src/pages/Home";
import { Icon } from "../../../../apps/desktop/src/components/Icon";
import { setLang, useT } from "../../../../apps/desktop/src/i18n";
import "../../../../apps/desktop/src/index.css";
import logoGlyph from "../../../../apps/desktop/src/assets/logo-glyph.png";
const query = new URLSearchParams(location.search);
if (query.has("dark")) document.documentElement.classList.add("dark");
if (query.has("en")) setLang("en");
function Preview() {
  const t = useT();
  return (
    <div
      className={`cb-frame ${query.has("windows") ? "is-windows" : "is-mac"}`}
    >
      {!query.has("windows") && (
        <div className="cb-window-drag" aria-hidden="true" />
      )}
      <header className="cb-global-nav">
        <div className="cb-wordmark">
          <span
            className="cb-logo-glyph"
            style={{
              maskImage: `url(${logoGlyph})`,
              WebkitMaskImage: `url(${logoGlyph})`,
            }}
          />
          <b>Crossbow</b>
        </div>
        <nav className="cb-primary-nav" aria-label={t("studio.navigation")}>
          {[
            "studio.connect",
            "studio.nodes",
            "studio.monitor",
            "studio.config",
            "studio.settings",
          ].map((key, i) => (
            <button key={key} className={i === 0 ? "active" : ""}>
              {t(key)}
            </button>
          ))}
        </nav>
        <div className="cb-global-tools">
          <button className="cb-btn cb-diagnostics-button">
            <Icon name="pulse" />
            {t("nav.diagnostics")}
          </button>
          <button className="cb-btn" aria-label="通知">
            <Icon name="bell" />
          </button>
        </div>
      </header>
      <main className="cb-paper">
        <div className="cb-page-content cb-view-home">
          <HomePage />
        </div>
      </main>
      <footer className="cb-system-foot">
        <span>正式 HomePage · 模拟 IPC · 不操作真实网络</span>
        <span>Crossbow v0.11.2 · V2 实现预览</span>
      </footer>
    </div>
  );
}
const root = createRoot(document.getElementById("root")!);
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
root.render(
  <React.StrictMode>
    <Preview />
  </React.StrictMode>,
);
