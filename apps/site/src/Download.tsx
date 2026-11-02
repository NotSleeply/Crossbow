import { Link } from "react-router-dom";
import { DownloadIcon } from "./components";
import { useLatestRelease } from "./hooks/useLatestRelease";
import { LATEST, RELEASES } from "./site-meta";

export default function Download({ standalone = false }: { standalone?: boolean }) {
  const Heading = standalone ? "h1" : "h2";
  const release = useLatestRelease();
  const platforms = [
    { name: "macOS", detail: "Apple Silicon · M 系列芯片", url: release?.dmgUrl, label: "下载 DMG", note: "Developer ID 签名与公证；拖入应用程序后启动。" },
    { name: "Windows", detail: "x64 · Windows 11", url: release?.windowsUrl, label: "下载 EXE", note: "尚无 Windows 代码签名；请核对官方来源及发布页中的 SHA256SUMS。" },
    { name: "Linux", detail: "x86_64 · 社区实验版", url: release?.linuxUrl, label: "下载 TAR.GZ", note: "已在 CachyOS / niri 环境验证部分功能。解压后以普通用户运行；代理需手动配置，TUN 需另装服务。" },
  ];
  return <section id="download" className="shell content-section download-section">
    <div className="section-heading"><Heading>下载 Crossbow</Heading><p>{release ? `${release.version}${release.date ? ` · ${release.date}` : ""} · ` : ""}macOS / Windows 支持应用内更新；Linux 实验版手动下载</p></div>
    <div className="download-platforms">{platforms.map(p => <article key={p.name} className="download-platform"><span className="platform-detail">{p.detail}</span><h3>Crossbow for {p.name}</h3><p>{p.note}</p><div className="platform-actions"><a className="primary-button" href={p.url ?? LATEST} target="_blank" rel="noopener noreferrer"><DownloadIcon />{p.url ? p.label : "查看发布与下载"}</a>{p.name === "Linux" && <Link className="text-link platform-guide" to="/guide#linux">Linux 安装与支持范围 →</Link>}</div></article>)}</div>
    <div className="download-links"><a href={LATEST} target="_blank" rel="noopener noreferrer">更新说明 ↗</a>{release?.checksumsUrl && <a href={release.checksumsUrl} target="_blank" rel="noopener noreferrer">SHA256SUMS ↗</a>}<a href={RELEASES} target="_blank" rel="noopener noreferrer">历史版本 ↗</a></div>
    <p className="download-note">iOS 正在真机开发验证中，暂未公开分发。安装或连接遇到问题，可先查看<Link to="/guide">进阶指南</Link>。</p>
  </section>;
}
