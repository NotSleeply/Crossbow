import { useState } from "react";
import heroApp from "../assets/hero-app.png";
import { Link } from "react-router-dom";
import { useLatestRelease } from "../hooks/useLatestRelease";
import { DownloadIcon } from "../components";
import { DMG_SHA256, DMG_URL, LATEST, MANIFEST_URL, REPO, RELEASES, VERSION } from "../site-meta";

const NAV = [
  { href: "#features", label: "特性" },
  { href: "#start", label: "快速上手" },
  { href: "#download", label: "下载" },
  { href: "#faq", label: "FAQ" },
];

function Hero() {
  const rel = useLatestRelease();
  const version = rel?.version ?? VERSION;
  return (
    <header id="top" style={{ padding: "96px 0 56px", textAlign: "center" }}>
      <div style={{ display: "inline-flex", alignItems: "center", gap: 8, font: "12px var(--mono)", color: "var(--dim)", border: "1px solid var(--line-strong)", borderRadius: 99, padding: "5px 14px", marginBottom: 26 }}>
        <span style={{ color: "var(--accent)" }}>{version}</span>
        <span>开源 · GPL-3.0</span>
        <span>macOS · Apple Silicon</span>
      </div>
      <h1 style={{ fontSize: 46, lineHeight: 1.18, fontWeight: 700, letterSpacing: "-.025em", maxWidth: 720, margin: "0 auto 20px" }}>
        轻量、克制、可靠的
        <br />
        <span
          style={{
            background: "linear-gradient(120deg, #7aa2ff 10%, #b79bff 60%, #8bb8ff)",
            WebkitBackgroundClip: "text",
            backgroundClip: "text",
            color: "transparent",
          }}
        >
          开源代理客户端
        </span>
      </h1>
      <p style={{ color: "var(--dim)", fontSize: 17, maxWidth: 560, margin: "0 auto 34px" }}>
        Crossbow 为 macOS 提供 mihomo / sing-box 双内核、系统代理与 TUN 模式。
        订阅管理、节点测速和网络诊断集中在一个界面，菜单栏随时查看实时速率。
      </p>
      <div style={{ display: "flex", gap: 12, justifyContent: "center", alignItems: "center", flexWrap: "wrap" }}>
        <a
          className="btn-primary"
          href={LATEST}
          target="_blank"
          rel="noopener"
          style={{
            display: "inline-flex", alignItems: "center", gap: 8, borderRadius: 10,
            padding: "12px 24px", fontSize: 14.5, fontWeight: 600, color: "#06111f",
            background: "linear-gradient(180deg, #85adff, #6d97ff)",
            boxShadow: "0 4px 20px rgba(122,162,255,.3), inset 0 1px 0 rgba(255,255,255,.35)",
          }}
        >
          <DownloadIcon />
          下载 {version}
        </a>
        <a
          href={REPO}
          target="_blank"
          rel="noopener"
          style={{
            display: "inline-flex", alignItems: "center", gap: 8, borderRadius: 10,
            padding: "12px 24px", fontSize: 14.5, fontWeight: 600,
            background: "var(--surface-2)", color: "var(--text)", border: "1px solid var(--line-strong)",
          }}
        >
          查看源码
        </a>
      </div>
      <div style={{ marginTop: 14, font: "11.5px var(--mono)", color: "var(--faint)" }}>
        免费开源 · 无追踪 · macOS Apple Silicon
      </div>

      <div
        style={{
          maxWidth: 980, margin: "56px auto 0", borderRadius: 14,
          border: "1px solid var(--line-strong)",
          boxShadow: "0 30px 80px rgba(0,0,0,.55), 0 0 0 1px rgba(255,255,255,.03)",
          overflow: "hidden",
        }}
      >
        <img src={heroApp} alt="Crossbow 主界面：仪表盘、实时速率曲线与配置档案" style={{ display: "block", width: "100%", height: "auto" }} />
      </div>
    </header>
  );
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
    text: "系统代理适合日常使用；TUN 可接管更多应用流量。两种模式在设置中切换，TUN 首次开启需要管理员授权。",
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
    text: "关闭窗口 = 内核与代理保留、界面内存归零。重新打开自动接管，状态无缝恢复；托盘一键切换。",
  },
  {
    icon: <path d="M2 12h4l2-5 3 10 3-7 2 2h6" />,
    title: "实时观测",
    text: "速率曲线、按进程聚合的流量排行、单连接断开、分级日志——运行状态尽收眼底。",
  },
];

function Features() {
  return (
    <section id="features" style={{ maxWidth: 1080, margin: "0 auto", padding: "84px 24px" }}>
      <div style={{ textAlign: "center", marginBottom: 48 }}>
        <span className="micro" style={{ display: "block", marginBottom: 12 }}>Features</span>
        <h2 style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-.02em" }}>把复杂留给内核，把简单交给你</h2>
        <p style={{ color: "var(--dim)", marginTop: 12, fontSize: 15 }}>每个特性都来自真实的日常使用反馈</p>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }}>
        {FEATURES.map((f) => (
          <div
            key={f.title}
            style={{
              background: "linear-gradient(180deg, rgba(255,255,255,.018), transparent 40%), var(--surface)",
              border: "1px solid var(--line)", borderRadius: 14, padding: "24px 22px",
            }}
          >
            <div style={{ width: 38, height: 38, borderRadius: 10, marginBottom: 16, display: "grid", placeItems: "center", background: "var(--accent-soft)" }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                {f.icon}
                {f.icon2}
              </svg>
            </div>
            <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>{f.title}</h3>
            <p style={{ color: "var(--dim)", fontSize: 13.5 }}>{f.text}</p>
          </div>
        ))}
      </div>

      <div
        style={{
          marginTop: 14, borderRadius: 14, padding: "22px 26px",
          display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap",
          background: "linear-gradient(120deg, rgba(122,162,255,.08), rgba(183,155,255,.05)), var(--surface)",
          border: "1px solid color-mix(in srgb, var(--accent) 25%, var(--line))",
        }}
      >
        <div style={{ flex: "1 1 380px" }}>
          <h3 style={{ fontSize: 15.5, fontWeight: 650, marginBottom: 6 }}>
            新：双内核引擎 + 菜单栏实时速率
          </h3>
          <p style={{ color: "var(--dim)", fontSize: 13.5, lineHeight: 1.7 }}>
            mihomo ↔ sing-box 一键切换（配置自动转换、规则集自更新）；菜单栏图标旁双行实时速率，宽度恒定不抖动。
          </p>
        </div>
        <Link to="/features" style={{ color: "var(--accent)", fontSize: 13.5, fontWeight: 600, flex: "none" }}>
          查看功能详解 →
        </Link>
      </div>
    </section>
  );
}

function Steps() {
  return (
    <section id="start" style={{ maxWidth: 1080, margin: "0 auto", padding: "40px 24px 84px" }}>
      <div style={{ textAlign: "center", marginBottom: 48 }}>
        <span className="micro" style={{ display: "block", marginBottom: 12 }}>Get Started</span>
        <h2 style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-.02em" }}>三步上手</h2>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }}>
        <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 14, padding: "26px 22px" }}>
          <div style={{ font: "600 13px var(--mono)", color: "var(--accent)", marginBottom: 14 }}>01</div>
          <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>下载并安装</h3>
          <p style={{ color: "var(--dim)", fontSize: 13.5 }}>
            从 GitHub Releases 下载官方 dmg，打开后将 Crossbow 拖入「应用程序」，再从应用程序文件夹启动。
          </p>
        </div>
        <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 14, padding: "26px 22px" }}>
          <div style={{ font: "600 13px var(--mono)", color: "var(--accent)", marginBottom: 14 }}>02</div>
          <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>导入订阅</h3>
          <p style={{ color: "var(--dim)", fontSize: 13.5 }}>
            粘贴订阅链接回车，或直接把 .yaml 配置文件拖进窗口。设置自动更新间隔，流量与到期自动追踪。
          </p>
        </div>
        <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 14, padding: "26px 22px" }}>
          <div style={{ font: "600 13px var(--mono)", color: "var(--accent)", marginBottom: 14 }}>03</div>
          <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>一键开启</h3>
          <p style={{ color: "var(--dim)", fontSize: 13.5 }}>
            选择节点，在首页开启系统代理；需要接管不读取系统代理的应用时，可到设置中开启 TUN。
          </p>
        </div>
      </div>
    </section>
  );
}

function Download() {
  const [copied, setCopied] = useState(false);
  const rel = useLatestRelease();
  const version = rel?.version ?? VERSION;
  const dmgUrl = rel?.dmgUrl ?? (rel ? LATEST : DMG_URL);
  const date = rel?.date ?? "2026-10-24";
  const shaKnown = version === VERSION; // 静态值里的 SHA256 与该版本对应
  const copy = () => {
    navigator.clipboard?.writeText(DMG_SHA256).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <section id="download" style={{ maxWidth: 1080, margin: "0 auto", padding: "40px 24px 84px" }}>
      <div style={{ textAlign: "center", marginBottom: 48 }}>
        <span className="micro" style={{ display: "block", marginBottom: 12 }}>Download</span>
        <h2 style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-.02em" }}>下载 Crossbow</h2>
        <p style={{ color: "var(--dim)", marginTop: 12, fontSize: 15 }}>应用内也可一键检查更新（minisign 签名校验）</p>
      </div>
      <div
        style={{
          maxWidth: 720, margin: "0 auto", textAlign: "center", padding: 36,
          background: "linear-gradient(180deg, rgba(255,255,255,.02), transparent 50%), var(--surface)",
          border: "1px solid var(--line-strong)", borderRadius: 16,
        }}
      >
        <div style={{ font: "600 13px var(--mono)", color: "var(--accent)" }}>{version} · {date}</div>
        <h3 style={{ fontSize: 22, fontWeight: 700, margin: "10px 0 6px" }}>Crossbow for macOS</h3>
        <div style={{ color: "var(--dim)", fontSize: 13 }}>Apple Silicon (M 系列) · macOS</div>
        <div style={{ display: "flex", gap: 12, justifyContent: "center", margin: "26px 0 18px", flexWrap: "wrap" }}>
          <a
            href={dmgUrl}
            target="_blank"
            rel="noopener"
            style={{
              display: "inline-flex", alignItems: "center", gap: 8, borderRadius: 10,
              padding: "12px 24px", fontSize: 14.5, fontWeight: 600, color: "#06111f",
              background: "linear-gradient(180deg, #85adff, #6d97ff)",
              boxShadow: "0 4px 20px rgba(122,162,255,.3), inset 0 1px 0 rgba(255,255,255,.35)",
            }}
          >
            <DownloadIcon />
            下载 dmg
          </a>
          <a
            href={RELEASES}
            target="_blank"
            rel="noopener"
            style={{ display: "inline-flex", alignItems: "center", borderRadius: 10, padding: "12px 24px", fontSize: 14.5, fontWeight: 600, background: "var(--surface-2)", color: "var(--text)", border: "1px solid var(--line-strong)" }}
          >
            全部版本
          </a>
        </div>
        {shaKnown && (
          <div
            onClick={copy}
            title="点击复制"
            style={{
              font: "11px var(--mono)", color: "var(--faint)", wordBreak: "break-all",
              background: "var(--surface-2)", border: "1px solid var(--line)",
              borderRadius: 8, padding: "8px 12px", display: "inline-block", cursor: "pointer",
            }}
          >
            {copied ? "SHA256 · 已复制 ✓" : `SHA256 · 点击复制：${DMG_SHA256.slice(0, 32)}…`}
          </div>
        )}
        <div style={{ marginTop: 16, fontSize: 12.5 }}>
          <a href={RELEASES} target="_blank" rel="noopener" style={{ color: "var(--accent)", margin: "0 8px" }}>历史版本</a>
          {" · "}
          <a href={MANIFEST_URL} target="_blank" rel="noopener" style={{ color: "var(--accent)", margin: "0 8px" }}>更新清单</a>
        </div>
      </div>
    </section>
  );
}

const FAQS = [
  {
    q: "安装或打开时遇到 macOS 安全提示？",
    a: <>请确认安装包来自 <a href={RELEASES} target="_blank" rel="noopener">GitHub Releases</a>，重新下载后按系统提示打开；不要使用来源不明的安装包。</>,
  },
  {
    q: "支持哪些协议？",
    a: <>内核为 mihomo，支持 Shadowsocks / VMess / VLESS / Trojan / Hysteria2 / TUIC / WireGuard 等全部 mihomo 所支持的协议，兼容 Clash 订阅与配置格式。</>,
  },
  {
    q: "支持 TUN 模式吗？",
    a: <>macOS 版可在设置中开启 TUN，首次开启需要管理员授权。TUN 与系统代理互斥；若其他 VPN 或代理已占用 TUN 路由，请先关闭其 TUN。v0.9.2 公开安装包早于最近的 TUN 恢复修复；测试前请阅读 <a href={`${REPO}/blob/main/docs/TUN-RECOVERY.md`} target="_blank" rel="noopener">离线恢复说明</a>。</>,
  },
  {
    q: "有 Windows / iOS 版本吗？",
    a: <>在路线图中：Windows 为 M1.5，iOS 为 M2（复用同一套核心逻辑）。目前 macOS 版本已可日常使用。</>,
  },
  {
    q: "升级会丢配置吗？",
    a: <>现有配置会继续保存在 ~/Library/Application Support/com.richard.crossbow/；旧版 com.crossbow.app 数据会在升级时迁移。配置保存前有快照，建议升级前仍自行备份。</>,
  },
  {
    q: "如何参与或反馈？",
    a: <>项目开源于 GitHub，Issue 与 PR 欢迎提交。日常使用中的每一条不便都是最高优先级的输入。</>,
  },
];

function Faq() {
  const [open, setOpen] = useState(0);
  return (
    <section id="faq" style={{ maxWidth: 1080, margin: "0 auto", padding: "40px 24px 84px" }}>
      <div style={{ textAlign: "center", marginBottom: 48 }}>
        <span className="micro" style={{ display: "block", marginBottom: 12 }}>FAQ</span>
        <h2 style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-.02em" }}>常见问题</h2>
      </div>
      <div style={{ maxWidth: 720, margin: "0 auto" }}>
        {FAQS.map((f, i) => (
          <details
            key={i}
            open={open === i}
            onToggle={() => setOpen(i)}
            style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, padding: "0 20px", marginBottom: 10 }}
          >
            <summary
              style={{
                cursor: "pointer", listStyle: "none", padding: "16px 0",
                fontSize: 14.5, fontWeight: 550,
                display: "flex", justifyContent: "space-between", alignItems: "center",
              }}
            >
              {f.q}
              <span style={{ color: "var(--faint)", fontSize: 16 }}>{open === i ? "−" : "+"}</span>
            </summary>
            <div style={{ color: "var(--dim)", fontSize: 13.5, paddingBottom: 18 }}>{f.a}</div>
          </details>
        ))}
      </div>
    </section>
  );
}

export default function HomePage() {
  return (
    <>
      <Hero />
      <Features />
      <Steps />
      <Download />
      <Faq />
    </>
  );
}
