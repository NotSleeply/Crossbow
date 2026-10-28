import { Logo } from "../components";
import { LATEST, REPO } from "../site-meta";
import { Link } from "react-router-dom";

const FEATURES = [
  {
    tag: "节点",
    title: "节点选择与测速",
    summary: "按地区、名称与延迟找到合适的节点，保留自动选择，也支持手动指定。",
    detail: [
      "按地区整理节点，结合名称搜索、可用过滤与延迟排序缩小范围。",
      "支持单节点与整组延迟测试，区分测速中、成功和超时状态。",
      "macOS 托盘中可切换节点并查看延迟，不必反复打开主窗口。",
    ],
  },
  {
    tag: "订阅",
    title: "订阅管理",
    summary:
      "URL / 粘贴 / 文件 / 拖拽 / 深链接五种方式导入；流量与到期自动追踪；自动更新失败保留旧配置并指数退避重试。",
    detail: [
      "导入即校验：格式不合法当场报错，不会写坏现有配置。",
      "订阅卡片直观展示剩余流量与到期时间，即将到期高亮提醒。",
      "自动更新间隔可按订阅独立设置（默认 6 小时）；更新失败不会清空节点，旧配置继续可用。",
      "支持 crossbow://import?url=… 深链接，从任意分享页一键导入。",
    ],
  },
  {
    tag: "守护",
    title: "系统代理守护",
    summary:
      "开启前快照原设置，退出/崩溃精确还原；内核异常自动降级恢复——告别「退出后断网」。",
    detail: [
      "开启代理前对每个网络服务的 HTTP/HTTPS/SOCKS 原设置拍照存档（journal）。",
      "正常退出、崩溃、甚至进程被强杀，下次启动都会先执行一次全量还原，不留脏设置。",
      "内核崩溃时立即还原系统代理并提示；覆写导致的配置错误自动进入安全模式（禁用覆写重启一次）。",
      "混合端口被其他程序占用时，启动前即明确报错，不让你对着「启动中」干等。",
    ],
  },
  {
    tag: "网络",
    title: "TUN 模式",
    summary:
      "通过虚拟网卡接管更多应用流量；可在设置中独立控制，并与本应用的系统代理同时开启。",
    detail: [
      "macOS 首次开启需管理员授权，Windows 需安装并使用后台服务；完成设置后可在界面开关 TUN。",
      "TUN 与本应用的系统代理可同时开启；其他代理或 VPN 的 TUN 应先关闭，避免路由冲突。",
      "若其他代理或 VPN 已占用隧道路由，先关闭对方的 TUN 模式；断网时可按仓库中的离线恢复说明操作。",
    ],
  },
  {
    tag: "诊断",
    title: "网络诊断向导",
    summary:
      "七项按依赖顺序自检：内核、控制器、配置、端口、系统代理指向、代理连通、DNS——失败项一键修复。",
    detail: [
      "逐层排查：先内核是否起来，再控制器是否就绪，然后配置是否合法、端口是否监听、系统代理是否指向本应用、代理是否真的能出网、DNS 是否可用。",
      "每一步都有结论与建议动作，常见问题（端口占用、覆写出错、订阅过期）可直接一键修复。",
      "诊断过程与结论持久化，方便反馈问题时附带。",
    ],
  },
  {
    tag: "覆写",
    title: "JS 覆写",
    summary:
      "用 function main(config) 改造订阅：过滤节点、改写规则、注入自定义配置。保存即校验，错误当场归因。",
    detail: [
      "内嵌 JS 引擎沙箱执行，无网络无文件副作用，只对订阅配置做纯函数变换。",
      "支持「脚本」与「Merge 补丁」两种覆写类型；可同时启用多条并绑定到指定订阅。",
      "保存时自动试运行：语法错误、运行时异常当场报错并定位到行。",
      "覆写出错不会拖垮内核：自动进入安全模式禁用全部覆写，修复后保存即恢复。",
    ],
  },
  {
    tag: "轻量",
    title: "轻量模式",
    summary:
      "关闭窗口后保留内核与代理，释放界面内存。重新打开自动接管，状态无缝恢复；托盘一键切换。",
    detail: [
      "轻量交接：GUI 进程只保留托盘与内核管理，webview 内存完全释放。",
      "内核以 detach 模式留给系统收养；重新打开应用自动收养并恢复全部状态。",
      "菜单栏托盘实时速率在轻量模式下照常跳动。",
    ],
  },
  {
    tag: "观测",
    title: "实时观测",
    summary:
      "菜单栏实时速率、速率曲线、按进程聚合的流量排行、单连接断开、分级日志——运行状态尽收眼底。",
    detail: [
      "菜单栏双行实时速率（上行/下行），数字恒宽显示不抖动。",
      "首页实时速率曲线 + 累计流量；当前出口节点与延迟一目了然。",
      "连接页按进程聚合流量排行，可单独断开任意连接。",
      "日志页分级过滤，排查规则命中问题不用翻配置。",
      "代理页可测试 YouTube、X、Google 与 GitHub 的连通性；测试结果用于排查当前代理链路。",
    ],
  },
  {
    tag: "引擎",
    title: "双内核引擎",
    summary:
      "mihomo 生态兼容性最佳，sing-box 新协议跟进快——应用内一键下载、切换即用。",
    detail: [
      "设置页一键下载对应内核（约 20MB，支持镜像加速），切换需内核已安装。",
      "切换即热重启：配置自动按引擎格式转换（sing-box 输出 JSON 并注入 Clash 兼容 API）。",
      "sing-box 专属：规则集（geoip/geosite）自动下载、本地缓存并每日自更新。",
      "切换后托盘速率、连接观测等全部功能无缝衔接。",
    ],
  },
];

export default function FeaturesPage() {
  return <div className="shell detail-page">
    <header className="page-heading"><h1>功能详解</h1><p>从订阅与节点，到接管与观测。了解每一步连接由什么组成。</p></header>
    <nav className="section-nav" aria-label="功能目录">{FEATURES.map((f,i) => <button key={f.tag} onClick={() => document.getElementById(`feature-${i+1}`)?.scrollIntoView({ block: "start" })}>{f.tag}</button>)}</nav>
    <div className="detail-list">{FEATURES.map((f,i) => <section className="detail-section" id={`feature-${i+1}`} key={f.title}>
      <div><h2>{f.title}</h2><p>{f.summary}</p></div><ul>{f.detail.map(d => <li key={d}>{d}</li>)}</ul>
    </section>)}</div>
    <div className="page-next"><div><h2>还有更多进阶玩法</h2><p>JS 覆写、双引擎切换、深链接导入，继续探索。</p></div><Link className="text-link" to="/guide">查看进阶指南 →</Link></div>
    <div className="page-meta"><Logo size={20} /><a href={`${REPO}/issues`} target="_blank" rel="noopener noreferrer">功能建议欢迎提 Issue ↗</a><a href={LATEST} target="_blank" rel="noopener noreferrer">下载体验 ↗</a></div>
  </div>;
}
