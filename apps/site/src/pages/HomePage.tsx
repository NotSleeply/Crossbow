import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { DownloadIcon } from "../components";
import { REPO, RELEASES } from "../site-meta";
import Download from "../Download";

function Hero() {
  const [paused, setPaused] = useState(false);
  const [hidden, setHidden] = useState(document.hidden);
  useEffect(() => {
    const change = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", change);
    return () => document.removeEventListener("visibilitychange", change);
  }, []);
  return <section className="hero shell" aria-labelledby="hero-title">
    <div className="hero-intro"><h1 id="hero-title">让连接，清晰可见。</h1><p>macOS 与 Windows 的开源代理客户端。<br className="mobile-break" />管理订阅与节点，也看清每一步连接。</p></div>
    <div className="flow-stage" role="img" aria-label="你的设备，经规则分流，连接目标网络。连接路径示意。">
      <div className="flow-node"><svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="14" rx="1.5"/><path d="M12 17v4m-5 0h10"/></svg><b>你的设备</b><span className="desktop-copy">macOS / Windows</span><span className="mobile-copy">桌面设备</span></div>
      <div className="flow-track" />
      <div className="flow-node"><svg viewBox="0 0 24 24"><path d="M3 5h18M3 12h18M3 19h18M7 2v6m10 1v6m-9 1v6"/></svg><b>规则分流</b><span>按需连接</span></div>
      <div className="flow-track" />
      <div className="flow-node"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18M5 6.5c4 3 10 3 14 0M5 17.5c4-3 10-3 14 0"/></svg><b>目标网络</b><span>代理 / 直连</span></div>
      <div className="flow-lane" aria-hidden="true"><span className="packet" style={{ animationPlayState: paused || hidden ? "paused" : "running" }} /></div>
    </div>
    <div className="hero-action"><Link className="primary-button" to="/download">下载 Crossbow <DownloadIcon /></Link><p>开源客户端，自备节点或配置。</p></div>
    <button className="pause-button" aria-pressed={paused} onClick={() => setPaused(!paused)}><span aria-hidden="true">{paused ? "▷" : "Ⅱ"}</span>{paused ? "继续动效" : "暂停动效"}</button>
  </section>;
}

const FEATURES = [
  {
    icon: <path d="M4 5h16v14H4z" />,
    icon2: <path d="M4 10h16M9 5v14" />,
    title: "订阅管理",
    text: "URL / 粘贴 / 文件 / 拖拽 / 深链接导入，流量与到期一目了然；自动更新失败保留旧配置并指数退避重试。",
  },
  {
    icon: <path d="M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z" />,
    icon2: <path d="M9 12l2 2 4-4" />,
    title: "系统代理与 TUN",
    text: "系统代理适合日常使用；TUN 可接管更多应用流量。两者可同时开启、独立控制；TUN 需按平台完成管理员授权或服务安装。",
  },
  {
    icon: <path d="M3 12h4l2-6 4 12 2-6h6" />,
    title: "网络诊断向导",
    text: "七项按依赖顺序自检：内核、控制器、配置、端口、系统代理指向、代理连通、DNS——失败项一键修复。",
  },
  {
    icon: <path d="M8 9l-4 3 4 3M16 9l4 3-4 3M13 5l-2 14" />,
    title: "JS 覆写",
    text: "用 function main(config) 改造订阅：过滤节点、改写规则。保存即校验，错误当场归因；沙箱执行无副作用。",
  },
  {
    icon: <path d="M13 2L5 13h6l-2 9 8-13h-6z" />,
    title: "轻量模式",
    text: "关闭窗口后保留内核与代理，释放界面内存。重新打开自动接管，状态无缝恢复；托盘一键切换。",
  },
  {
    icon: <path d="M2 12h4l2-5 3 10 3-7 2 2h6" />,
    title: "实时观测",
    text: "速率曲线、按进程聚合的流量排行、单连接断开、分级日志——运行状态尽收眼底。",
  },
];

function Features() {
  return <section id="features" className="shell content-section">
    <div className="section-heading"><h2>把复杂留给内核，把简单交给你</h2><p>每个特性都来自真实的日常使用反馈</p></div>
    <div className="feature-grid">{FEATURES.map(f => <article className="feature-card" key={f.title}>
      <svg className="feature-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{f.icon}{f.icon2}</svg>
      <h3>{f.title}</h3><p>{f.text}</p>
    </article>)}</div>
    <div className="feature-callout"><div><h3>双内核引擎 + 菜单栏实时速率</h3><p>mihomo ↔ sing-box 一键切换，配置自动转换、规则集自动更新；macOS 菜单栏双行速率，恒宽展示。</p></div><Link className="text-link" to="/features">查看功能详解 →</Link></div>
  </section>;
}
function Steps() {
  return <section id="start" className="shell content-section">
    <div className="section-heading"><h2>三步上手</h2></div>
    <div className="steps-grid">
      {/* taste-skill-ignore: retain user-requested three installation steps. */}<article className="step-card"><span className="step-number">01</span><h3>下载并安装</h3><p>macOS 下载 DMG 并拖入「应用程序」；Windows 下载 x64 安装程序。安装包均来自 GitHub Releases。</p></article>
      {/* taste-skill-ignore: retain user-requested three installation steps. */}<article className="step-card"><span className="step-number">02</span><h3>导入订阅</h3><p>粘贴订阅链接，或把 .yaml 配置文件拖进窗口。设置自动更新间隔，查看流量与到期信息。</p></article>
      {/* taste-skill-ignore: retain user-requested three installation steps. */}<article className="step-card"><span className="step-number">03</span><h3>一键开启</h3><p>选择节点，在概览开启系统代理。需要接管更多应用流量时，可按平台完成授权并开启 TUN。</p></article>
    </div>
    <Link className="text-link section-more" to="/guide">继续阅读进阶指南 →</Link>
  </section>;
}
const FAQS = [
  {
    q: "安装或打开时遇到 macOS 安全提示？",
    a: <>请确认安装包来自 <a href={RELEASES} target="_blank" rel="noopener">GitHub Releases</a>，重新下载后按系统提示打开；不要使用来源不明的安装包。</>,
  },
  {
    q: "支持哪些协议？",
    a: <>可使用 mihomo 或 sing-box，协议支持以所选内核为准。mihomo 支持 Shadowsocks / VMess / VLESS / Trojan / Hysteria2 / TUIC / WireGuard 等全部 mihomo 所支持的协议，兼容 Clash 订阅与配置格式。</>,
  },
  {
    q: "支持 TUN 模式吗？",
    a: <>macOS 与 Windows 可在设置中开启 TUN，首次需按平台完成管理员授权或服务安装。可与本应用的系统代理同时开启、独立控制；若其他 VPN 或代理已占用 TUN 路由，请先关闭其 TUN。测试前请阅读 <a href={`${REPO}/blob/main/docs/TUN-RECOVERY.md`} target="_blank" rel="noopener">离线恢复说明</a>。</>,
  },
  {
    q: "有 Windows / iOS 版本吗？",
    a: <>已提供 Windows x64 安装包，持续完善中；Windows 11 的外观、代理与日志修复需要实机验收，Windows 支持通过服务模式运行 TUN。iOS 正在真机开发验证中，尚未公开分发。</>,
  },
  {
    q: "升级会丢配置吗？",
    a: <>macOS 配置会继续保存在 ~/Library/Application Support/com.richard.crossbow/；旧版 com.crossbow.app 数据会在升级时迁移。配置保存前有快照，建议升级前仍自行备份。</>,
  },
  {
    q: "如何参与或反馈？",
    a: <>项目开源于 GitHub，Issue 与 PR 欢迎提交。日常使用中的每一条不便都是最高优先级的输入。</>,
  },
];


function Faq() {
  return <section id="faq" className="shell content-section faq-section"><div className="section-heading"><h2>常见问题</h2></div><div className="faq-list">{FAQS.map(f => <details key={f.q} name="faq"><summary>{f.q}<span aria-hidden="true">+</span></summary><div>{f.a}</div></details>)}</div></section>;
}
export default function HomePage() { return <><Hero /><Features /><Steps /><Download /><Faq /></>; }
