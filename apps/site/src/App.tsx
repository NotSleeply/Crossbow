import { useEffect, useRef, useState } from "react";
import { Link, Route, Routes, useLocation } from "react-router-dom";
import { Logo } from "./components";
import { REPO, RELEASES } from "./site-meta";
import HomePage from "./pages/HomePage";
import FeaturesPage from "./pages/FeaturesPage";
import GuidePage from "./pages/GuidePage";
import Download from "./Download";

const NAV = [{ to: "/", label: "首页" }, { to: "/features", label: "功能详解" }, { to: "/guide", label: "进阶指南" }];

export default function App() {
  const { pathname } = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const main = useRef<HTMLElement>(null);
  const footer = useRef<HTMLElement>(null);
  useEffect(() => {
    setMenuOpen(false);
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    document.title = `${pathname === "/features" ? "功能详解" : pathname === "/guide" ? "进阶指南" : pathname === "/download" ? "下载" : "让连接，清晰可见"} · Crossbow`;
  }, [pathname]);
  useEffect(() => {
    if (main.current) main.current.inert = menuOpen;
    if (footer.current) footer.current.inert = menuOpen;
    const previous = document.body.style.overflow;
    if (menuOpen) document.body.style.overflow = "hidden";
    const close = (e: KeyboardEvent) => {
      if (e.key === "Escape" && menuOpen) { setMenuOpen(false); menuButton.current?.focus(); }
    };
    const wide = window.matchMedia("(min-width: 761px)");
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
    <a className="skip-link" href="#main" onClick={e => { e.preventDefault(); main.current?.focus(); }}>跳到主要内容</a>
    <header className="site-header">
      <div className="shell nav-shell">
        <Link to="/" onClick={() => window.scrollTo({ top: 0, behavior: "instant" })} className="brand" aria-label="Crossbow 首页"><Logo size={36} />Crossbow</Link>
        <button ref={menuButton} className="menu-button" aria-expanded={menuOpen} aria-controls="site-nav" onClick={() => setMenuOpen(!menuOpen)}>菜单 <span aria-hidden="true">{menuOpen ? "−" : "+"}</span></button>
        <nav id="site-nav" aria-label="主导航" className={menuOpen ? "nav-open" : ""}>
          {NAV.map(n => <Link key={n.to} to={n.to} onClick={() => window.scrollTo({ top: 0, behavior: "instant" })} aria-current={pathname === n.to ? "page" : undefined}>{n.label}</Link>)}
          <a href={REPO} target="_blank" rel="noopener noreferrer">GitHub <span aria-hidden="true">↗</span></a>
          <Link to="/download" aria-current={pathname === "/download" ? "page" : undefined}>下载</Link>
        </nav>
      </div>
    </header>
    <main id="main" ref={main} tabIndex={-1}>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/features" element={<FeaturesPage />} />
        <Route path="/guide" element={<GuidePage />} />
        <Route path="/download" element={<div className="download-page"><Download standalone /></div>} />
        <Route path="*" element={<div className="shell not-found"><h1>这条路径还未连接。</h1><Link className="text-link" to="/">返回首页 →</Link></div>} />
      </Routes>
    </main>
    <footer ref={footer} className="site-footer">
      <div className="shell footer-main">
        <Link to="/" onClick={() => window.scrollTo({ top: 0, behavior: "instant" })} className="brand"><Logo size={28} />Crossbow</Link>
        <div className="footer-links"><Link to="/features">功能详解</Link><Link to="/guide">进阶指南</Link><a href={RELEASES} target="_blank" rel="noopener noreferrer">历史版本 ↗</a><a href={`${REPO}/issues`} target="_blank" rel="noopener noreferrer">反馈问题 ↗</a></div>
      </div>
      <div className="shell footer-bottom"><span>© 2026 Crossbow Contributors</span><span><a href={`${REPO}/blob/main/LICENSE`} target="_blank" rel="noopener noreferrer">GPL-3.0 开源</a> · 自备节点或配置</span></div>
    </footer>
  </>;
}
