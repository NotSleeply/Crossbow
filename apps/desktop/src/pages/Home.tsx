import NodeName from "../components/NodeName";
import { nodeNameText } from "../components/nodeFlags";
import { notify, notificationText } from "../notifications/service";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  CORE_MODES,
  ipc,
  type CoreMode,
  type CoreStatus,
  type OutboundInfo,
  type Profile,
  type SysProxyStatus,
  type UpdateState,
  type PlatformCapabilities,
} from "../ipc";
import { fmtBytes } from "../format";
import { useT } from "../i18n";
import { Icon } from "../components/Icon";
import { UpdateBanner } from "../components/UpdateBanner";
import { ConnectionFlow } from "../components/ConnectionFlow";

const POINTS = 120;

/** 概览：连接状态、路径与趋势，配合独立的接管控制区。 */
export default function HomePage({ capabilities }: { capabilities: PlatformCapabilities | null }) {
  const t = useT();
  const explicitOnly = capabilities !== null && !capabilities.system_proxy && !capabilities.tun;
  const [mixedPort, setMixedPort] = useState<number | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [core, setCore] = useState<CoreStatus>({ state: "Stopped" });
  const [proxy, setProxy] = useState<SysProxyStatus>({
    enabled: false,
    port: 0,
  });
  const [tun, setTun] = useState({
    enabled: false,
    ready: false,
    coreRunning: false,
  });
  const [mode, setMode] = useState<CoreMode>("rule");
  const [busy, setBusy] = useState(false);
  const [rates, setRates] = useState<{ up: number; down: number }[]>([]);
  const [lastTrafficAt, setLastTrafficAt] = useState(0);
  const [totals, setTotals] = useState({ up: 0, down: 0 });
  const [connCount, setConnCount] = useState<number | null>(null);
  const [outbound, setOutbound] = useState<OutboundInfo | null>(null);
  const [update, setUpdate] = useState<UpdateState | null>(null);
  const mounted = useRef(true);
  const subscriptionGeneration = useRef(0);

  useEffect(() => {
    let active = true;
    let receivedEvent = false;
    const un = ipc.onUpdateState((state) => {
      if (!active) return;
      receivedEvent = true;
      setUpdate(state);
    });
    void un
      .then(() => ipc.updateStateGet())
      .then((state) => {
        if (active && !receivedEvent) setUpdate(state);
      })
      .catch(() => {});
    return () => {
      active = false;
      void un.then((f) => f());
    };
  }, []);

  // Conflict feedback shares the same queue and is deduplicated across polls.
  useEffect(() => {
    let active = true;
    let hadConflict = false;
    const check = async () => {
      try {
        const findings = await ipc.coexistDetect();
        if (!active) return;
        // 通知降噪（用户反馈）：只在其他 TUN 实际接管默认路由时弹——
        // 常驻服务/闲置内核进程属正常状态（退出 Verge 后其服务仍在），
        // 每次启动都提示是狼来了
        const tunnel = findings.find((finding) => finding.kind === "tunnel");
        if (tunnel) {
          hadConflict = true;
          notify.publish({
            kind: "warning",
            title: t("home.coexistTitle"),
            description: t("home.coexistHint"),
            details: findings.map((finding) => finding.detail).join("\n"),
            source: "coexist",
            operationId: "coexist",
            duration: 0,
            actions: ["diagnostics"],
          });
        } else if (hadConflict) {
          hadConflict = false;
          void notify.publish({
            kind: "success",
            code: "coexist.resolved",
            source: "coexist",
            operationId: "coexist",
          });
        }
      } catch (error) {
        if (active) notify.error(error, "coexist-read");
      }
    };
    void check();
    const timer = window.setInterval(check, 60_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!mounted.current) return;
    setProfiles(await ipc.listProfiles().catch(() => []));
    setActiveId(await ipc.activeProfileId().catch(() => null));
    setCore(
      await ipc.coreStatus().catch(() => ({ state: "Stopped" as const })),
    );
    setProxy(
      await ipc.sysproxyStatus().catch(() => ({ enabled: false, port: 0 })),
    );
    setTun(
      await ipc.tunStatus().catch(() => ({
        enabled: false,
        ready: false,
        coreRunning: false,
      })),
    );
    setMode(await ipc.coreMode().catch(() => "rule" as const));
    setMixedPort(await ipc.getEngineConfig().then((config) => config.mixed_port).catch(() => null));
    setOutbound(await ipc.currentOutbound().catch(() => null));
  }, []);

  useEffect(() => {
    const generation = ++subscriptionGeneration.current;
    let active = true;
    mounted.current = true;
    refresh();
    const un1 = ipc.onCoreStatus((status) => {
      setCore(status);
      if (status.state !== "Running") setLastTrafficAt(0);
      if (active)
        ipc
          .tunStatus()
          .then(setTun)
          .catch((e) => notify.error(e, "tun-state-read"));
    });
    const un2 = ipc.onSysproxyStatus(setProxy);
    const untun = ipc.onTunStatus((enabled) => {
      if (active) setTun((current) => ({ ...current, enabled }));
    });
    const un3 = ipc.onCoreMode(setMode);
    const un4 = ipc.onTraffic(({ up, down }) => {
      if (!active || !mounted.current) return;
      if (
        (Number.isFinite(up) && up > 0) ||
        (Number.isFinite(down) && down > 0)
      ) {
        setLastTrafficAt(Date.now());
      }
      setRates((prev) => [...prev.slice(-(POINTS - 1)), { up, down }]);
      setTotals((t0) => ({ up: t0.up + up, down: t0.down + down }));
    });
    const un5 = ipc.onConnections((s) => {
      if (active && mounted.current) setConnCount(s.rows.length);
    });

    // 速率历史预填（#181）：后端环形缓冲由托盘通道每秒喂入，与页面
    // 存亡无关——切页回来不再从空白重画
    void ipc
      .trafficHistory()
      .then((history) => {
        if (active && mounted.current && history.length > 0)
          setRates(history.slice(-POINTS));
      })
      .catch(() => {});

    // Install event listeners before starting the streams so that the first
    // websocket frames after a TUN/core restart cannot race past the webview.
    const subscribe = Promise.all([un1, un2, un3, un4, un5, untun]).then(() => {
      if (!active || subscriptionGeneration.current !== generation) return;
      return Promise.allSettled([
        ipc.subscribeTraffic(),
        ipc.subscribeConnections(),
      ]);
    });

    return () => {
      active = false;
      mounted.current = false;
      for (const un of [un1, un2, un3, un4, un5, untun])
        void un.then((f) => f());
      // React StrictMode immediately mounts this page again in development.
      // Wait for in-flight subscribe commands, then let the new generation
      // decide whether the backend streams should remain active.
      void subscribe
        .catch(() => {})
        .finally(() => {
          queueMicrotask(() => {
            if (subscriptionGeneration.current === generation) {
              ipc.unsubscribeTraffic().catch(() => {});
              ipc.unsubscribeConnections().catch(() => {});
            }
          });
        });
    };
  }, [refresh]);

  // 状态自愈：事件丢失或 WS 通道冻结（内核重启竞态，#111）最迟 30s 对齐
  // 一次。重订借后端替换语义——新读线程以当前 port/secret 顶替旧通道，
  // 冻结在死端口上的旧读线程随之退场。
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!mounted.current) return;
      void refresh();
      ipc.subscribeTraffic().catch(() => {});
      ipc.subscribeConnections().catch(() => {});
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const toggleProxy = async () => {
    setBusy(true);
    try {
      await ipc.sysproxyToggle();
      await refresh();
    } catch {
      // The command reports failure through the backend-owned notification.
    } finally {
      setBusy(false);
    }
  };

  const toggleTun = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await ipc.setTun(!tun.enabled);
    } catch {
      // setTun publishes its result in the backend.
    } finally {
      await refresh();
      setBusy(false);
    }
  };

  const toggleCore = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await notify.run("explicit-core", t("home.core"),
        () => running ? ipc.coreStop() : ipc.coreStart(),
        undefined, { feedback: "error-only", titleKey: "home.core" });
    } finally {
      await refresh();
      setBusy(false);
    }
  };

  const active = profiles.find((p) => p.id === activeId);
  const latest = rates[rates.length - 1];
  const running = core.state === "Running" || core.state === "Starting";
  const routingEnabled = proxy.enabled || tun.enabled;
  // 标题与副标题同源（core.state）：tun.coreRunning 独立取数，曾在重启
  // 竞态下与副标题各说各话（#111）
  const statusTitle = explicitOnly
    ? t(core.state === "Starting" ? "home.coreStarting" : core.state === "Running" ? "linux.explicitOn" : "linux.explicitOff")
    : tun.enabled
    ? running
      ? proxy.enabled
        ? t("home.tunAndSysproxyOn")
        : t("home.tunOn")
      : t("home.tunCoreStopped")
    : proxy.enabled
      ? t("home.sysproxyOn")
      : t("home.sysproxyOff");

  const statusHint = !activeId
    ? t("studio.noSource")
    : explicitOnly
      ? t("linux.explicitHint", { port: mixedPort ?? "—" })
    : !running && routingEnabled
      ? t("studio.coreUnavailable")
      : tun.enabled && proxy.enabled
        ? t("studio.bothHint")
        : tun.enabled
          ? t("studio.tunHint")
          : proxy.enabled
            ? t("studio.proxyHint")
            : t("studio.enableHint");

  const go = (page: string) =>
    window.dispatchEvent(new CustomEvent("cb:goto", { detail: page }));
  return (
    <div className="cb-home-page">
      <PageHead title={t("studio.workbench")} meta={t("studio.overviewHint")} />
      {update && <UpdateBanner update={update} onOpen={() => go("settings")} />}
      <div className="cb-home-layout">
        <section className="cb-home-main">
          <div className="cb-home-lead">
            <div className="cb-home-status">
              <div className="cb-status-line">
                <i
                  className={`cb-dot ${core.state === "Crashed" || (routingEnabled && !running) ? "bad" : running ? "ok" : "idle"}`}
                />
                {coreText(t, core)}
              </div>
              <span className="cb-home-mode">{t(`mode.${mode}`)}</span>
            </div>
            <h2>{statusTitle}</h2>
            <p>{statusHint}</p>
          </div>
          <section className="cb-home-path" aria-label={t("studio.path")}>
            <div className="cb-path-heading">
              <h3>{t("studio.path")}</h3>
              <span title={outbound?.chain.map(nodeNameText).join(" → ")}>
                <NodeName name={outbound?.chain[0] ?? t(`mode.${mode}`)} />
              </span>
            </div>
            <ConnectionFlow
              enabled={
                core.state === "Running" && (routingEnabled || explicitOnly) && !!outbound?.node
              }
              lastTrafficAt={lastTrafficAt}
            >
              <div>
                <span className="cb-route-mark">
                  <Icon name="device" size={32} />
                </span>
                <b>{t("studio.thisDevice")}</b>
                <small>
                  {navigator.userAgent.includes("Windows")
                    ? "Windows"
                    : navigator.userAgent.includes("Macintosh") ? "macOS" : "Linux"}
                </small>
              </div>
              <span
                className="cb-route-line"
                data-route-segment
                aria-hidden="true"
              />
              <div>
                <span className="cb-route-mark">
                  <Icon name="sliders" size={32} />
                </span>
                <b>
                  {t(
                    mode === "direct"
                      ? "studio.directRouting"
                      : mode === "global"
                        ? "studio.globalRouting"
                        : "studio.routing",
                  )}
                </b>
                <small>{t(`mode.${mode}`)}</small>
              </div>
              <span
                className="cb-route-line"
                data-route-segment
                aria-hidden="true"
              />
              <div>
                <span className="cb-route-mark">
                  <Icon name="globe" size={32} />
                </span>
                <b title={outbound?.node ? nodeNameText(outbound.node) : undefined}><NodeName name={outbound?.node ?? "—"} /></b>
                <small>
                  {outbound?.delay_ms != null
                    ? outbound.delay_ms > 0
                      ? `${outbound.delay_ms} ms`
                      : t("sites.error.timeout")
                    : coreText(t, core)}
                </small>
              </div>
            </ConnectionFlow>
          </section>
          <div className="cb-home-actions">
            <button className="cb-btn primary" onClick={() => go("proxies")}>
              <Icon name="bolt" />
              {t("studio.chooseNode")}
            </button>
            <button className="cb-btn" onClick={() => go("connections")}>
              <Icon name="cube" />
              {t("studio.viewConnections")}
            </button>
          </div>
          <section className="cb-chart-only" aria-label={t("studio.trend")}>
            <div className="cb-chart-head">
              <div>
                <h3>{t("studio.trend")}</h3>
                <span>{t("studio.lastMinute")} · KB/s</span>
              </div>
              <div className="cb-chart-legend">
                <span>
                  <i className="down" />
                  {t("studio.download")}
                </span>
                <span>
                  <i className="up" />
                  {t("studio.upload")}
                </span>
              </div>
            </div>
            <Sparkline rates={rates} />
            <div className="cb-chart-foot">
              <span>{t("studio.secondsAgo", { seconds: 120 })}</span>
              <span>{t("studio.secondsAgo", { seconds: 60 })}</span>
              <span>{t("studio.now")}</span>
            </div>
          </section>
        </section>
        <div className="cb-home-side-slot">
          <aside className="cb-home-side">
            <section className="cb-takeover-panel">
              <div className="cb-home-card-title">
                <h3>{t("studio.takeover")}</h3>
                <details
                  className="cb-home-help"
                  onKeyDown={(event) => {
                    if (event.key === "Escape")
                      event.currentTarget.open = false;
                  }}
                  onBlur={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget))
                      event.currentTarget.open = false;
                  }}
                >
                  <summary aria-label={t("studio.takeoverHelp")}>?</summary>
                  <div>
                    <p>{t("studio.proxyHint")}</p>
                    <p>{t("studio.tunHint")}</p>
                    <p>{t("studio.independent")}</p>
                  </div>
                </details>
              </div>
              {explicitOnly && (
                <div className="cb-takeover-row">
                  <div>
                    <b>{t("linux.explicitProxy")}</b>
                    <p>{t("linux.explicitHint", { port: mixedPort ?? "—" })}</p>
                  </div>
                  <button className={`cb-toggle ${core.state === "Running" ? "on" : ""}`}
                    role="switch" aria-label={t("linux.explicitProxy")}
                    aria-checked={core.state === "Running"} onClick={toggleCore}
                    disabled={busy || !activeId || core.state === "Starting"} />
                </div>
              )}
              <div className="cb-takeover-row" title={t(capabilities?.system_proxy ? "studio.proxyHint" : "linux.takeoverUnavailable")}>
                <div>
                  <b>{t("studio.proxy")}</b>
                  <p>{t(capabilities?.system_proxy ? "studio.proxyHint" : "linux.takeoverUnavailable")}</p>
                </div>
                <button
                  className={`cb-toggle ${proxy.enabled ? "on" : ""}`}
                  role="switch"
                  aria-label={t("studio.proxy")}
                  aria-checked={proxy.enabled}
                  onClick={toggleProxy}
                  disabled={busy || !activeId || !capabilities?.system_proxy}
                />
              </div>
              <div className="cb-takeover-row" title={t(capabilities?.tun ? "studio.tunHint" : "linux.takeoverUnavailable")}>
                <div>
                  <b>{t("settings.tun")}</b>
                  <p>{t(capabilities?.tun ? "studio.tunHint" : "linux.takeoverUnavailable")}</p>
                </div>
                <button
                  className={`cb-toggle ${tun.enabled ? "on" : ""}`}
                  role="switch"
                  aria-label={t("settings.tun")}
                  aria-checked={tun.enabled}
                  onClick={toggleTun}
                  disabled={busy || !activeId || !capabilities?.tun}
                />
              </div>
              <div className="cb-mode-control">
                <p>{t("studio.mode")}</p>
                <div
                  className="cb-seg"
                  role="group"
                  aria-label={t("studio.mode")}
                >
                  {CORE_MODES.map((m) => (
                    <button
                      key={m.id}
                      className={mode === m.id ? "on" : ""}
                      aria-pressed={mode === m.id}
                      onClick={() =>
                        notify.run(
                          "core-mode",
                          notificationText("core.mode"),
                          () => ipc.setCoreMode(m.id),
                          undefined,
                          { feedback: "error-only" },
                        )
                      }
                    >
                      {t(`mode.${m.id}`)}
                    </button>
                  ))}
                </div>
              </div>
            </section>
            <button
              className="cb-source-strip"
              title={active?.name ?? t("studio.noSource")}
              onClick={() => go("profiles")}
            >
              <Icon name="document" size={26} />
              <div>
                <b>{active?.name ?? t("home.none")}</b>
                <p>
                  {t("studio.currentSource")} ·{" "}
                  {active?.kind === "remote"
                    ? t("profiles.remote")
                    : t("profiles.local")}
                </p>
              </div>
              <Icon name="chevron" size={17} />
            </button>
            <section className="cb-rate-card" aria-label={t("home.rate")}>
              <div className="cb-home-card-title">
                <h3>{t("home.rate")}</h3>
                <span className="cb-rate-state">
                  <i
                    className={`cb-dot ${core.state === "Running" ? "ok" : "idle"}`}
                  />
                  {coreText(t, core)}
                </span>
              </div>
              <div className="cb-rate-pair">
                <div>
                  <span>↓ {t("studio.download")}</span>
                  <RateValue bytes={latest?.down ?? 0} />
                </div>
                <div>
                  <span>↑ {t("studio.upload")}</span>
                  <RateValue bytes={latest?.up ?? 0} />
                </div>
              </div>
              <div className="cb-session-strip">
                <div>
                  <span>{t("studio.totalDown")}</span>
                  <b>{fmtBytes(totals.down)}</b>
                </div>
                <div>
                  <span>{t("studio.totalUp")}</span>
                  <b>{fmtBytes(totals.up)}</b>
                </div>
                <div>
                  <span>{t("home.connections")}</span>
                  <b>{connCount?.toLocaleString() ?? "—"}</b>
                </div>
              </div>
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}

export function PageHead({
  title,
  meta,
  children,
}: {
  title: string;
  meta?: string;
  children?: React.ReactNode;
}) {
  return (
    <header className="cb-page-head">
      <div className="cb-page-heading">
        <h1>{title}</h1>
        {meta && <p>{meta}</p>}
      </div>
      {children && <div className="cb-page-actions">{children}</div>}
    </header>
  );
}

function RateValue({ bytes }: { bytes: number }) {
  const [value, unit] = fmtBytes(bytes).split(" ");
  return (
    <p>
      <b>{value}</b>
      <small>{unit}/s</small>
    </p>
  );
}

/** 120 秒同一时间轴；短历史留空，不拉伸已有样本。 */
function Sparkline({ rates }: { rates: { up: number; down: number }[] }) {
  const W = 640;
  const H = 120;
  const peak = Math.max(1024, ...rates.map((r) => Math.max(r.up, r.down)));
  const stepKB = 10 ** Math.floor(Math.log10(peak / 1024));
  const max = Math.ceil(peak / 1024 / stepKB) * stepKB * 1024;
  const smooth = (key: "up" | "down") => {
    if (rates.length < 2) return "";
    const step = W / (POINTS - 1);
    const offset = POINTS - rates.length;
    const pts = rates.map((r, i) => ({
      x: (i + offset) * step,
      y: H - (r[key] / max) * (H - 10) - 4,
    }));
    let d = `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
    for (let i = 1; i < pts.length; i++) {
      const p0 = pts[i - 1];
      const p1 = pts[i];
      const mx = ((p0.x + p1.x) / 2).toFixed(1);
      d += ` C${mx},${p0.y.toFixed(1)} ${mx},${p1.y.toFixed(1)} ${p1.x.toFixed(1)},${p1.y.toFixed(1)}`;
    }
    return d;
  };
  const upLine = smooth("up");
  return (
    <div className="cb-chart-drawing">
      <div className="cb-chart-axis" aria-hidden="true">
        {[1, 2 / 3, 1 / 3, 0].map((ratio) => (
          <span key={ratio}>
            {new Intl.NumberFormat("en", {
              notation: "compact",
              maximumSignificantDigits: 2,
            }).format((max * ratio) / 1024)}
          </span>
        ))}
      </div>
      <svg
        aria-hidden="true"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="cb-traffic-plot"
      >
        <g style={{ stroke: "var(--cb-line)" }}>
          <line x1="0" y1="6" x2={W} y2="6" />
          <line x1="0" y1="42.7" x2={W} y2="42.7" />
          <line x1="0" y1="79.3" x2={W} y2="79.3" />
          <line x1="0" y1="116" x2={W} y2="116" />
        </g>
        {upLine && (
          <>
            <path
              d={upLine}
              fill="none"
              style={{ stroke: "var(--cb-up)" }}
              strokeWidth="1.6"
            />
          </>
        )}
        {smooth("down") && (
          <path
            d={smooth("down")}
            fill="none"
            style={{ stroke: "var(--cb-down)" }}
            strokeWidth="1.4"
            opacity=".9"
          />
        )}
      </svg>
    </div>
  );
}

function coreText(t: ReturnType<typeof useT>, s: CoreStatus): string {
  switch (s.state) {
    case "Running":
      return t("home.coreRunning");
    case "Starting":
      return t("home.coreStarting");
    case "Crashed":
      return t("home.coreCrashed", { msg: s.message ?? "?" });
    default:
      return t("home.coreStopped");
  }
}
