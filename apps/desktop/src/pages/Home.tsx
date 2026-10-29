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
} from "../ipc";
import { fmtBytes } from "../format";
import { useT } from "../i18n";
import { Icon } from "../components/Icon";
import { UpdateBanner } from "../components/UpdateBanner";
import { ConnectionFlow } from "../components/ConnectionFlow";

const POINTS = 120;

/** 首页（v2）：状态卡 + KPI + 平滑速率曲线 + 配置档案。 */
export default function HomePage() {
  const t = useT();
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
          notify.success(notificationText("coexist.resolved"), "coexist");
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
      if ((Number.isFinite(up) && up > 0) || (Number.isFinite(down) && down > 0)) {
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
        if (active && mounted.current && history.length > 0) setRates(history.slice(-POINTS));
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
    } catch (error) {
      notify.error(
        error,
        "tun-switch",
        t(tun.enabled ? "settings.tunOffFailed" : "settings.tunFailed"),
      );
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
  const statusTitle = tun.enabled
    ? running
      ? proxy.enabled
        ? t("home.tunAndSysproxyOn")
        : t("home.tunOn")
      : t("home.tunCoreStopped")
    : proxy.enabled
      ? t("home.sysproxyOn")
      : t("home.sysproxyOff");

  const go = (page: string) =>
    window.dispatchEvent(new CustomEvent("cb:goto", { detail: page }));
  return (
    <div className="cb-home-page">
      <PageHead title={t("studio.workbench")} meta={t("studio.overviewHint")} />
      {update && <UpdateBanner update={update} onOpen={() => go("settings")} />}
      <div className="cb-home-layout">
        <section className="cb-home-main">
          <div className="cb-home-overview">
            <div className="cb-home-lead">
              <div className="cb-status-line">
                <i
                  className={`cb-dot ${core.state === "Crashed" || (routingEnabled && !running) ? "bad" : running ? "ok" : "idle"}`}
                />
                {coreText(t, core)}
              </div>
              <h2>{statusTitle}</h2>
              <p>
                {t("home.activeProfile")} {active?.name ?? t("home.none")}
              </p>
            </div>
            <ConnectionFlow
              enabled={
                core.state === "Running" && routingEnabled && !!outbound?.node
              }
              lastTrafficAt={lastTrafficAt}
            >
              <div>
                <Icon name="device" size={26} />
                <b>{t("studio.thisDevice")}</b>
                <small>
                  {navigator.userAgent.includes("Windows") ? "Windows" : "macOS"}
                </small>
              </div>
              <span
                className="cb-route-line"
                data-route-segment
                aria-hidden="true"
              />
              <div>
                <Icon name="sliders" size={26} />
                <b>{t("studio.routing")}</b>
                <small>{t(`mode.${mode}`)}</small>
              </div>
              <span
                className="cb-route-line"
                data-route-segment
                aria-hidden="true"
              />
              <div>
                <Icon name="globe" size={26} />
                <b title={outbound?.node}>{outbound?.node ?? "—"}</b>
                <small>
                  {outbound?.delay_ms != null
                    ? outbound.delay_ms > 0
                      ? `${outbound.delay_ms} ms`
                      : t("sites.error.timeout")
                    : coreText(t, core)}
                </small>
              </div>
            </ConnectionFlow>
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
          </div>
          <div className="cb-chart-only">
            <Sparkline rates={rates} />
            <div className="cb-chart-foot">
              <span>{t("studio.lastMinute")}</span>
              <span>{t("studio.now")}</span>
            </div>
          </div>
        </section>
        <aside className="cb-home-side">
          <section className="cb-takeover-panel">
            <h3>{t("studio.takeover")}</h3>
            <div className="cb-takeover-row" title={t("studio.proxyHint")}>
              <div>
                <b>{t("studio.proxy")}</b>
                <p>{t("studio.proxyHint")}</p>
              </div>
              <button
                className={`cb-toggle ${proxy.enabled ? "on" : ""}`}
                role="switch"
                aria-label={t("studio.proxy")}
                aria-checked={proxy.enabled}
                onClick={toggleProxy}
                disabled={busy || !activeId}
              />
            </div>
            <div className="cb-takeover-row" title={t("studio.tunHint")}>
              <div>
                <b>{t("settings.tun")}</b>
                <p>{t("studio.tunHint")}</p>
              </div>
              <button
                className={`cb-toggle ${tun.enabled ? "on" : ""}`}
                role="switch"
                aria-label={t("settings.tun")}
                aria-checked={tun.enabled}
                onClick={toggleTun}
                disabled={busy || !activeId}
              />
            </div>
            <div className="cb-mode-control">
              <p>{t("studio.mode")}</p>
              <div className="cb-seg">
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
                      )
                    }
                  >
                    {t(`mode.${m.id}`)}
                  </button>
                ))}
              </div>
            </div>
            <p className="cb-control-note">{t("studio.independent")}</p>
          </section>
          <button className="cb-source-strip" onClick={() => go("profiles")}>
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
          <section className="cb-rate-card">
            <div className="cb-chart-head">
              <div>
                <h3>{t("home.rate")}</h3>
                <p>{t("studio.lastMinute")} · KB/s</p>
              </div>
              <div className="cb-rate-pair">
                <span>
                  ↓ <b>{fmtBytes(latest?.down ?? 0)}</b>/s
                </span>
                <span>
                  ↑ <b>{fmtBytes(latest?.up ?? 0)}</b>/s
                </span>
              </div>
            </div>
            <div className="cb-session-strip">
              <span>
                {t("studio.totalDown")} <b>{fmtBytes(totals.down)}</b>
              </span>
              <span>
                {t("studio.totalUp")} <b>{fmtBytes(totals.up)}</b>
              </span>
              <span>
                {t("home.connections")} <b>{connCount ?? "—"}</b>
              </span>
            </div>
          </section>
          {!activeId && (
            <p className="cb-control-note">{t("studio.noSource")}</p>
          )}
        </aside>
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

/** 平滑贝塞尔双线 sparkline（对齐设计稿 v2）。 */
function Sparkline({ rates }: { rates: { up: number; down: number }[] }) {
  const W = 640;
  const H = 120;
  const max = Math.max(1, ...rates.map((r) => Math.max(r.up, r.down)));
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
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="cb-traffic-plot"
    >
      <g style={{ stroke: "var(--cb-line)" }}>
        <line x1="0" y1="30" x2={W} y2="30" />
        <line x1="0" y1="60" x2={W} y2="60" />
        <line x1="0" y1="90" x2={W} y2="90" />
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
