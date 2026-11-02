import { useEffect, useRef, useState } from "react";
import { Link, Route, Routes, useLocation } from "react-router-dom";
import { DownloadIcon, GitHubIcon, Logo } from "./components";
import PreferenceControls from "./PreferenceControls";
import { usePreferences } from "./preferences";
import { REPO, RELEASES } from "./site-meta";
import HomePage from "./pages/HomePage";
import FeaturesPage from "./pages/FeaturesPage";
import GuidePage from "./pages/GuidePage";
import Download from "./Download";

const NAV = [{ to: "/", label: "首页" }, { to: "/features", label: "功能详解" }, { to: "/guide", label: "进阶指南" }] as const;

export default function App() {
  const { pathname, hash } = useLocation();
  const { t } = usePreferences();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const main = useRef<HTMLElement>(null);
  const footer = useRef<HTMLElement>(null);
  useEffect(() => {
    setMenuOpen(false);
    const anchor = hash ? document.getElementById(hash.slice(1)) : null;
    if (anchor) anchor.scrollIntoView({ block: "start", behavior: "instant" });
    else window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [pathname, hash]);
  useEffect(() => {
    document.title = `${t(pathname === "/features" ? "功能详解" : pathname === "/guide" ? "进阶指南" : pathname === "/download" ? "下载" : "让连接，清晰可见")} · Crossbow`;
  }, [pathname, t]);
  useEffect(() => {
    if (main.current) main.current.inert = menuOpen;
    if (footer.current) footer.current.inert = menuOpen;
    const previous = document.body.style.overflow;
    if (menuOpen) document.body.style.overflow = "hidden";
    const close = (e: KeyboardEvent) => {
      if (e.key === "Escape" && menuOpen) { setMenuOpen(false); menuButton.current?.focus(); }
    };
    const wide = window.matchMedia("(min-width: 1001px)");
    const resize = () => { if (wide.matches) setMenuOpen(false); };
    window.addEventListener("keydown", close);
    wide.addEventListener("change", resize);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", close);
      wide.removeEventListener("change", resize);
    };
  }, [menuOpen]);
  return <>
    <a className="skip-link" href="#main" onClick={e => { e.preventDefault(); main.current?.focus(); }}>{t("跳到主要内容")}</a>
    <header className="site-header">
      <div className="shell nav-shell">
        <Link to="/" onClick={() => { setMenuOpen(false); window.scrollTo({ top: 0, behavior: "instant" }); }} className="brand" aria-label={t("Crossbow 首页")}><Logo size={32} /><span>Crossbow</span></Link>
        <nav id="site-nav" aria-label={t("主导航")} className={menuOpen ? "nav-open" : ""}>
          {NAV.map(n => <Link key={n.to} to={n.to} onClick={() => { setMenuOpen(false); window.scrollTo({ top: 0, behavior: "instant" }); }} aria-current={pathname === n.to ? "page" : undefined}>{t(n.label)}</Link>)}
          <a className="mobile-github" href={REPO} target="_blank" rel="noopener noreferrer" onClick={() => setMenuOpen(false)}><GitHubIcon />GitHub<span aria-hidden="true">↗</span></a>
        </nav>
        <div className="nav-actions">
          <a className="nav-tool nav-github" href={REPO} target="_blank" rel="noopener noreferrer" aria-label={t("GitHub 源代码（在新标签页打开）")} title={t("GitHub 源代码")}><GitHubIcon /></a>
          <PreferenceControls />
          <Link className="nav-download" to="/download" aria-label={t("下载 Crossbow")} aria-current={pathname === "/download" ? "page" : undefined} onClick={() => setMenuOpen(false)}><DownloadIcon /><span>{t("下载")}</span></Link>
          <button ref={menuButton} className="menu-button nav-tool" aria-label={t(menuOpen ? "关闭菜单" : "打开菜单")} aria-expanded={menuOpen} aria-controls="site-nav" onClick={() => setMenuOpen(!menuOpen)}><svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">{menuOpen ? <path d="m6 6 12 12M6 18 18 6" /> : <path d="M4 8h16M4 16h16" />}</svg></button>
        </div>
      </div>
    </header>
    <main id="main" ref={main} tabIndex={-1}>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/features" element={<FeaturesPage />} />
        <Route path="/guide" element={<GuidePage />} />
        <Route path="/download" element={<div className="download-page"><Download standalone /></div>} />
        <Route path="*" element={<div className="shell not-found"><h1>{t("这条路径还未连接。")}</h1><Link className="text-link" to="/">{t("返回首页 →")}</Link></div>} />
      </Routes>
    </main>
    <footer ref={footer} className="site-footer">
      <div className="shell footer-main">
        <Link to="/" onClick={() => window.scrollTo({ top: 0, behavior: "instant" })} className="brand"><Logo size={28} />Crossbow</Link>
        <div className="footer-links"><Link to="/features">{t("功能详解")}</Link><Link to="/guide">{t("进阶指南")}</Link><a href={RELEASES} target="_blank" rel="noopener noreferrer">{t("历史版本 ↗")}</a><a href={`${REPO}/issues`} target="_blank" rel="noopener noreferrer">{t("反馈问题 ↗")}</a></div>
      </div>
      <div className="shell footer-bottom"><span>© 2026 Crossbow Contributors</span><span><a href={`${REPO}/blob/main/LICENSE`} target="_blank" rel="noopener noreferrer">{t("GPL-3.0 开源")}</a> {t("· 自备节点或配置")}</span></div>
    </footer>
  </>;
}
