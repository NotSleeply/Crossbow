import { usePreferences } from "../preferences";
import { Link } from "react-router-dom";
import { DownloadIcon } from "../components";
import { LATEST, REPO } from "../site-meta";

const CODE_FILTER = `function main(config) {
  // 只保留名字含「香港」或「JP」的节点
  config.proxies = config.proxies.filter(p =>
    /香港|JP/.test(p.name)
  );

  // 规则：流媒体走「自动选择」，其余 MATCH 兜底
  config.rules = [
    "DOMAIN-SUFFIX,netflix.com,自动选择",
    "GEOIP,CN,DIRECT",
    "MATCH,自动选择",
  ];
  return config;
}`;

// Keep Chinese node/group names literal so the sample still matches the subscription.
const CODE_FILTER_EN = `function main(config) {
  // Keep nodes whose names include 香港 (Hong Kong) or JP.
  config.proxies = config.proxies.filter(p =>
    /香港|JP/.test(p.name)
  );

  // Route streaming through 自动选择 (Auto select), then use MATCH.
  config.rules = [
    "DOMAIN-SUFFIX,netflix.com,自动选择",
    "GEOIP,CN,DIRECT",
    "MATCH,自动选择",
  ];
  return config;
}`;

const CODE_DEEPLINK = `crossbow://import?url=https%3A%2F%2Fexample.com%2Fsub`;

function H2({ children }: { children: React.ReactNode }) { return <h2>{children}</h2>; }
function Card({ children, id }: { children: React.ReactNode; id?: string }) { return <section className="guide-card" id={id}>{children}</section>; }
function Step({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return <div className="guide-step"><span>{n}</span><div><h3>{title}</h3><div>{children}</div></div></div>;
}
function Code({ children }: { children: string }) { return <pre className="code-block"><code>{children}</code></pre>; }

export default function GuidePage() {
  const { t, language } = usePreferences();
  return (
    <div className="shell guide-page">
      <header className="page-heading">

        <h1>{t("进阶指南")}</h1>
        <p>
           {t("从内核切换到配置覆写，按场景找到下一步操作。")} </p>
      </header>

      <div className="guide-list">
        <Card>
          <H2>{t("双内核引擎：mihomo ↔ sing-box")}</H2>
          <p style={{ color: "var(--dim)", fontSize: 15, lineHeight: 1.75, margin: "10px 0 4px" }}>
             {t("Crossbow 支持 mihomo 与 sing-box 两种内核。选择时请确认订阅中的节点协议与规则被目标内核支持。配置会按引擎自动转换格式，切换即热重启。")} </p>
          {/* taste-skill-ignore: ordered procedure, not decorative numbering. */}<Step n="01" title={t("下载内核")}>
             {t("设置 → 内核引擎 → 选择 sing-box → 点「下载内核」（约 20MB，内置镜像加速；已下载的内核不会重复下载）。")} </Step>
          {/* taste-skill-ignore: ordered procedure, not decorative numbering. */}<Step n="02" title={t("一键切换")}>
             {t("在「设置 → 网络与内核」选择目标引擎，按提示下载缺失内核；安装完成后应用目标引擎。运行中的内核会重新加载或重启，配置按引擎转换格式。")} </Step>
          {/* taste-skill-ignore: ordered procedure, not decorative numbering. */}<Step n="03" title={t("注意")}>
             {t("切换前确认当前订阅的节点类型被目标内核支持（绝大多数常见协议两者都支持；个别小众协议建议留在 mihomo）。规则集（geoip/geosite）在 sing-box 下会自动下载并每日自更新。")} </Step>
        </Card>

        <Card>
          <H2>{t("JS 覆写：把订阅改成你想要的样子")}</H2>
          <p style={{ color: "var(--dim)", fontSize: 15, lineHeight: 1.75, margin: "10px 0 4px" }}>
             {t("配置 → 覆写链 → 新建覆写 → 选择「JS 脚本」，编写")} <code style={{ font: "12px var(--mono)" }}>function main(config)</code>{t("， 返回改造后的配置。沙箱执行、无网络无文件副作用，保存时自动试运行。")} </p>
          <Code>{language === "en" ? CODE_FILTER_EN : CODE_FILTER}</Code>
          {/* taste-skill-ignore: ordered procedure, not decorative numbering. */}<Step n="01" title={t("编写并绑定")}>
             {t("新建脚本 → 粘贴代码 → 保存（自动校验，语法/运行时错误当场报）→ 勾选「绑定到当前订阅」并启用。")} </Step>
          {/* taste-skill-ignore: ordered procedure, not decorative numbering. */}<Step n="02" title={t("多条覆写按序执行")}>
             {t("可同时启用多条覆写与 Merge 补丁，按列表顺序依次应用到订阅上。")} </Step>
          {/* taste-skill-ignore: ordered procedure, not decorative numbering. */}<Step n="03" title={t("出错兜底")}>
             {t("覆写导致内核启动失败时会自动进入「安全模式」：全部覆写临时禁用并重启内核。修复脚本后保存即恢复正常。")} </Step>
        </Card>

        <Card>
          <H2>{t("深链接导入：从任意页面一键订阅")}</H2>
          <p style={{ color: "var(--dim)", fontSize: 15, lineHeight: 1.75, margin: "10px 0 4px" }}>
             {t("网页上放一个这样的链接，已安装 Crossbow 的用户点击即弹出导入确认：")} </p>
          <Code>{CODE_DEEPLINK}</Code>
          <p style={{ color: "var(--dim)", fontSize: 13, lineHeight: 1.7 }}>
             {t("url 参数需要 URL 编码。未安装的用户可回落到官网下载页——适合机场/自建服务者在文档里引用。")} </p>
        </Card>

        <Card>
          <H2>{t("菜单栏实时速率")}</H2>
          <p style={{ color: "var(--dim)", fontSize: 15, lineHeight: 1.75, margin: "10px 0 4px" }}>
             {t("内核运行时，菜单栏图标旁实时显示 ↑ 上行 / ↓ 下行（每秒刷新，双行紧凑排版，宽度恒定不抖动）。 轻量模式下照常工作；内核停止自动消失。该功能目前仅 macOS 提供。")} </p>
        </Card>

        <Card>
          <H2>{t("混合端口与绕过")}</H2>
          <p style={{ color: "var(--dim)", fontSize: 15, lineHeight: 1.75, margin: "10px 0 4px" }}>
             {t("混合监听端口供 HTTP 与 SOCKS5 共用，默认 7897。在「设置 → 网络与内核」点击端口旁的「修改」，编辑后点击「应用」或按 Enter；Escape 可取消，失去焦点不会保存。运行中的内核可能短暂重启，系统代理绕过本机与局域网地址。")} </p>
          <p style={{ color: "var(--dim)", fontSize: 13, lineHeight: 1.7 }}>
             {t("提示：若 7897 被其他代理工具占用（常见于 Clash Verge 等），开启时会明确报错——换一个端口即可。")} </p>
          <p className="guide-intro">{t("需要给同一网络的设备提供代理时，可开启「允许局域网连接」，使用本机局域网 IP 与混合端口。该选项会监听 0.0.0.0，请仅在可信网络开启，并确认系统防火墙规则。")}</p>
        </Card>

        <Card id="linux">
          <H2>{t("Linux 实验版：先确认支持范围")}</H2>
          <p className="guide-intro">{t("社区已提供 x86_64 归档，主要在 CachyOS + niri / Wayland 验证。感谢")} <a href="https://github.com/YangYuS8" target="_blank" rel="noopener noreferrer">YangYuS8</a>  {t("的适配与实机反馈。其他发行版和桌面环境尚未全面验收。")}</p>
          {/* taste-skill-ignore: ordered installation procedure. */}<Step n="01" title={t("解压，以普通用户运行")}>
             {t("在")}<Link to="/download">{t("下载页")}</Link>{t("获取 TAR.GZ，核对 SHA256SUMS 后解压，运行")} <code>./run.sh</code>{t("。GUI 不需要以 root 身份启动；尚未提供 AppImage / DEB 或应用内自动更新。")} </Step>
          {/* taste-skill-ignore: ordered installation procedure. */}<Step n="02" title={t("手动设置应用代理")}>
             {t("导入订阅并选择可用节点，在浏览器或终端设置 HTTP / SOCKS 代理，地址为 127.0.0.1，端口以 Crossbow 设置为准。Linux 实验版不会自动更改桌面的系统代理；先用站点连通性测试检查内核链路。")} </Step>
          {/* taste-skill-ignore: ordered installation procedure. */}<Step n="03" title={t("需要 TUN，再安装服务")}>
             {t("需 systemd / polkit 与 mihomo，按仓库的")} <a href={`${REPO}/blob/main/docs/LINUX-NETWORK.md`} target="_blank" rel="noopener noreferrer">{t("Linux 网络说明")}</a>{t("安装可选服务。完整宿主机 TUN、休眠恢复和其他桌面场景仍在验证，请先准备恢复方案；不要同时开启其他 VPN 的 TUN。")} </Step>
          <p className="release-scope">{t("发布与开发进展分开看：Linux 关窗后的后台任务、冷启动深链接与原生系统通知改进已合入 main，是否包含在你下载的版本中请核对")} <a href={LATEST} target="_blank" rel="noopener noreferrer">{t("发布说明")}</a>{t("。详细验收记录见")} <a href={`${REPO}/blob/main/docs/LINUX-TESTING.md`} target="_blank" rel="noopener noreferrer">{t("Linux 测试文档")}</a>{t("。")}</p>
        </Card>

        <Card>
          <H2>{t("系统代理与 TUN 怎么选")}</H2>
          <p style={{ color: "var(--dim)", fontSize: 15, lineHeight: 1.75, margin: "10px 0 4px" }}>
             {t("macOS / Windows 日常浏览可先使用首页的系统代理；需要代理不读取系统代理设置的应用时，在设置中开启 TUN。 本应用的两种方式可同时开启、独立控制。关闭 TUN 后请检查系统代理状态和网络连接。")} </p>
          {/* taste-skill-ignore: ordered procedure, not decorative numbering. */}<Step n="01" title={t("开启前")}>
             {t("先关闭 Clash Verge 或其他 VPN 的 TUN 模式，确认当前配置与节点可用。若要测试断网恢复，先按离线恢复说明检查备用代理。")} </Step>
          {/* taste-skill-ignore: ordered procedure, not decorative numbering. */}<Step n="02" title={t("开启和检查")}>
             {t("设置 → TUN 模式 → 开启；macOS 首次需要管理员授权，Windows 需先安装后台服务。访问网页并观察日志和菜单栏速率，确认流量经过内核。")} </Step>
          {/* taste-skill-ignore: ordered procedure, not decorative numbering. */}<Step n="03" title={t("关闭或恢复")}>
             {t("关闭 TUN 后确认原系统代理状态与网络连接已恢复。若测试时断网，可在终端运行仓库中的")} {" "}<a href={`${REPO}/blob/main/docs/TUN-RECOVERY.md`} target="_blank" rel="noopener" style={{ color: "var(--accent)" }}>{t("离线恢复命令")}</a>{t("；该命令依赖仍在运行的备用代理。")} </Step>
        </Card>

        <Card>
          <H2>{t("轻量模式与托盘")}</H2>
          <p style={{ color: "var(--dim)", fontSize: 15, lineHeight: 1.75, margin: "10px 0 4px" }}>
             {t("设置 → 轻量模式开启后：点关闭窗口 = 代理照常、界面内存释放、托盘常驻。再点托盘图标即恢复窗口。 彻底退出请走托盘菜单「退出」。内核运行时关闭窗口，内核会以交接模式保留，重新打开自动接管。")} </p>
        </Card>

        <Card>
          <H2>{t("用通知中心追踪需要处理的问题")}</H2>
          <p className="guide-intro">{t("点击顶部铃铛查看最近通知。未读与待处理是不同状态：全部已读不会解决故障；进入诊断或设置完成修复后，原记录会显示已恢复。")}</p>
          <p className="guide-intro">{t("主题、语言与普通设置成功时不再重复提醒。进度通知收起后任务继续，出错时可查看脱敏详情。记录仅在本次会话中保留，排查长期问题请同时查看日志。")}</p>
        </Card>

        <Card id="subscriptions">
          <H2>{t("订阅更新：知道更新了什么")}</H2>
          <p className="guide-intro">{t("在「配置 → 配置来源」选择订阅，先看更新状态，再决定是否手动更新。")}</p>
          <Step n="01" title={t("查看更新时间")}>
            {t("详情显示上次成功、下次更新或失败后的重试时间。自动更新可关闭，也可选择 6、12 或 24 小时间隔。")}
          </Step>
          <Step n="02" title={t("失败与节点变化")}>
            {t("更新失败时保留原配置，并展示最近失败原因；成功后可查看新增、移除和变化的节点数量，快速判断订阅内容是否改变。")}
          </Step>
        </Card>

        <Card id="recovery">
          <H2>{t("从配置快照恢复")}</H2>
          <p className="guide-intro">{t("配置保存前自动保留最近五份快照。在「配置」页面点击「配置恢复」，按时间和内容选择恢复点。")}</p>
          <Step n="01" title={t("先确认范围")}>
            {t("恢复会替换订阅、本地配置、覆写链与当前配置选择；外观、端口、内核和接管设置保留。快照列表会显示配置与覆写数量。")}
          </Step>
          <Step n="02" title={t("恢复后检查连接")}>
            {t("恢复前会保留当前版本，运行中的内核可能短暂重新加载或重启；完成后检查当前配置、节点与诊断结果。升级前仍建议自行备份数据目录。")}
          </Step>
        </Card>

        <Card id="troubleshooting">
          <H2>{t("连接不通时，按证据排查")}</H2>
          <p className="guide-intro">{t("内核运行、接管配置与网络连通性是不同状态。首页显示运行中，不代表浏览器已经可以访问目标网站。")}</p>
          <Step n="01" title={t("先看诊断的第一个阻塞项")}>
            {t("打开「监测 → 诊断」或顶部「诊断」，逐项查看检查中、通过、失败与跳过。先处理优先展示的阻塞项，按可用修复操作或配置入口处理，再重新检查。")}
          </Step>
          <Step n="02" title={t("用连接和日志定位规则")}>
            {t("在「监测 → 连接」搜索目标、规则、链路或进程，点击行查看并复制完整详情。在「日志」中多选级别、筛选关键词；暂停跟随阅读，复制单条或导出当前筛选的脱敏日志。")}
          </Step>
          <Step n="03" title={t("站点测试要看测试上下文")}>
            {t("节点页的站点连通性测试保留时间与出口。切换链路后应重新测试；HTTP 限制响应表示目标作出响应但限制访问，不等于连接失败，也不代表浏览器一定走代理。")}
          </Step>
        </Card>

        <Card id="updates">
          <H2>{t("应用内更新：检查、下载与安装")}</H2>
          <p className="guide-intro">{t("macOS / Windows 在「设置 → 应用与更新」检查版本。Linux 实验版需手动下载新归档。")}</p>
          <Step n="01" title={t("手动检查后再确认下载")}>
            {t("「检查更新」只检查版本；发现新版后点击「下载」，完成后按提示重启安装。即使开启自动下载，手动检查仍会等待下载确认。")}
          </Step>
          <Step n="02" title={t("按需设置后台更新")}>
            {t("自动检查与自动下载可以分别设置；自动检查在启动后约 30 秒和之后每 6 小时执行，自动下载仅作用于这类定时检查。")}
          </Step>
        </Card>

        <Card id="windows">
          <H2>{t("Windows 安装与 TUN 服务")}</H2>
          <p className="guide-intro">{t("Windows x64 安装包附带 CrossbowService，TUN 依赖该服务。安装或更新提示文件被占用时，先关闭其他 Crossbow 实例，按安装器提示重试；服务缺失时使用完整安装包修复。安装包签名与支持范围以发布说明为准。")}</p>
          <p className="guide-intro"><a href={`${REPO}/blob/main/docs/WINDOWS-INSTALL.md`} target="_blank" rel="noopener noreferrer">{t("查看 Windows 安装、服务与升级说明 ↗")}</a></p>
        </Card>

        <Card>
          <H2>{t("配置与数据的位置")}</H2>
          <p style={{ color: "var(--dim)", fontSize: 15, lineHeight: 1.75, margin: "10px 0 4px" }}>
             {t("macOS 数据在")} <code style={{ font: "12px var(--mono)" }}>~/Library/Application Support/com.richard.crossbow/</code>{t("： store.json（订阅/设置/覆写，保存前自动快照保留 5 份）、runtime/（内核运行时与日志）、binaries/（内核本体）。 旧版")} <code style={{ font: "12px var(--mono)" }}>com.crossbow.app</code>  {t("数据会自动迁移；升级前可备份新目录。")} </p>
        </Card>
      </div>

      <div
        style={{
          marginTop: 48, textAlign: "center", padding: "32px 24px",
          background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 16,
        }}
      >
        <h3 style={{ fontSize: 18, fontWeight: 700 }}>{t("还没安装？")}</h3>
        <p style={{ color: "var(--dim)", fontSize: 15, margin: "8px auto 20px" }}>{t("免费开源，提供 macOS Apple Silicon、Windows x64 安装包与 Linux x86_64 实验版。")}</p>
        <a
          href={LATEST}
          target="_blank"
          rel="noopener"
          className="btn-primary"
          style={{
            display: "inline-flex", alignItems: "center", gap: 8, borderRadius: 10,
            padding: "11px 22px", fontSize: 14, fontWeight: 600, color: "var(--on-button)",
            background: "var(--button)",
          }}
        >
          <DownloadIcon />
           {t("下载 Crossbow")} </a>
        {" "}
        <a
          href={`${REPO}/tree/main/docs`}
          target="_blank"
          rel="noopener"
          style={{ marginLeft: 10, color: "var(--dim)", fontSize: 15 }}
        >
           {t("设计文档（DESIGN / MVP）")} </a>
      </div>
    </div>
  );
}
