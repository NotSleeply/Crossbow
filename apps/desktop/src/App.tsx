import { notify } from "./notifications/service";
import { useEffect, useState } from "react";
import HomePage from "./pages/Home";
import ProxiesPage from "./pages/Proxies";
import ProfilesPage from "./pages/Profiles";
import ConnectionsPage from "./pages/Connections";
import DiagnosticsPage from "./pages/Diagnostics";
import LogsPage from "./pages/Logs";
import SettingsPage from "./pages/Settings";
import { initLang, useT } from "./i18n";
import { getCurrentWindow } from "@tauri-apps/api/window";
import logoGlyph from "./assets/logo-glyph.png";
import { Icon } from "./components/Icon";

/** Overlay 标题栏拖拽：显式 startDragging（data-tauri-drag-region 在
 *  Overlay 样式下不可靠），主键按下才触发，不影响子元素交互。 */
export function dragWindow(e: React.MouseEvent) {
  if (e.button === 0) {
    e.preventDefault();
    getCurrentWindow().startDragging();
  }
}
import { ipc, type UiSettings } from "./ipc";
import {
  NotificationHistory,
  useNotificationNavigation,
} from "./notifications/NotificationProvider";

const PAGES = [
  "home",
  "proxies",
  "connections",
  "logs",
  "diagnostics",
  "profiles",
  "settings",
] as const;
type PageId = (typeof PAGES)[number];
const isPage = (value: string): value is PageId =>
  PAGES.includes(value as PageId);

/// 从版本串提取短版本：mihomo「… v1.19.32 …」→ v1.19.32；sing-box「sing-box version 1.14.2」→ 1.14.2
function shortVersion(version: string | undefined): string {
  const v = version ?? "";
  const vTok = v.match(/v\d+\.\d+\.\d+/);
  if (vTok) return vTok[0];
  const i = v.indexOf("version ");
  if (i >= 0)
    return (
      v
        .slice(i + 8)
        .trim()
        .split(/\s+/)[0] || v
    );
  return v.split(/\s+/).slice(0, 1).join(" ");
}

function applyTheme(theme: UiSettings["theme"]) {
  const dark =
    theme === "dark" ||
    (theme === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

export default function App() {
  const t = useT();
  const isWindows = navigator.userAgent.includes("Windows");
  const [page, setPage] = useState<PageId>("home");
  const [settingSection, setSettingSection] = useState<
    "network" | "appearance" | "logs" | "app"
  >("network");
  const [configTab, setConfigTab] = useState<"sources" | "overrides">(
    "sources",
  );
  const [profileName, setProfileName] = useState("");
  const [appVersion, setAppVersion] = useState("");
  const [coreRunning, setCoreRunning] = useState(false);
  const [coreLabel, setCoreLabel] = useState<string>("");

  useEffect(() => {
    let active = true;
    let receivedStatus = false;
    const un = ipc.onCoreStatus((status) => {
      receivedStatus = true;
      if (active) setCoreRunning(status.state === "Running");
    });
    void un
      .then(() => ipc.coreStatus())
      .then((status) => {
        if (active && !receivedStatus)
          setCoreRunning(status.state === "Running");
      })
      .catch(() => {});
    void ipc
      .appVersion()
      .then((value) => {
        if (active) setAppVersion(value);
      })
      .catch(() => {});
    return () => {
      active = false;
      void un.then((off) => off());
    };
  }, []);

  useEffect(() => {
    let alive = true;
    void Promise.all([ipc.listProfiles(), ipc.activeProfileId()])
      .then(([profiles, id]) => {
        if (alive)
          setProfileName(
            profiles.find((profile) => profile.id === id)?.name ?? "",
          );
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [page]);

  const refreshCoreLabel = () => {
    ipc
      .getEngineConfig()
      .then((e) =>
        ipc
          .coreBinaryInfoFor(e.engine)
          .then((info) =>
            setCoreLabel(
              `${e.engine === "singbox" ? "sing-box" : "mihomo"} ${shortVersion(info?.version)}`,
            ),
          ),
      )
      .catch((error) => notify.error(error, "app-settings-read"));
  };

  useEffect(() => {
    // 窗口底部的内核标识：跟随持久化引擎与其二进制版本；引擎切换时重取
    refreshCoreLabel();
    let unlisten: (() => void) | null = null;
    ipc.onEngineChanged(refreshCoreLabel).then((f) => {
      unlisten = f;
    });
    return () => {
      unlisten?.();
    };
  }, []);

  // 托盘「发现新版本」等入口跳转设置页
  useEffect(() => {
    const un = ipc.onGoto((p) => {
      if (isPage(p)) {
        setPage(p);
        if (p === "settings") setSettingSection("app");
        if (p === "profiles") setConfigTab("sources");
      }
    });
    return () => {
      void un.then((f) => f());
    };
  }, []);

  useEffect(() => {
    initLang();
    let currentTheme: UiSettings["theme"] = "system";
    const updateTheme = (theme: UiSettings["theme"]) => {
      currentTheme = theme;
      applyTheme(theme);
    };
    ipc
      .getUiSettings()
      .then((u) => updateTheme(u.theme))
      .catch((error) => notify.error(error, "app-settings-read"));
    const un = ipc.onTheme(updateTheme);
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onSystem = () => {
      if (currentTheme === "system") applyTheme("system");
    };
    mq.addEventListener("change", onSystem);
    return () => {
      void un.then((f) => f());
      mq.removeEventListener("change", onSystem);
    };
  }, []);

  useEffect(() => {
    const navigate = (event: Event) => {
      const next = (event as CustomEvent<string>).detail;
      if (isPage(next)) {
        setPage(next);
        if (next === "settings") setSettingSection("app");
        if (next === "profiles") setConfigTab("sources");
      }
    };
    window.addEventListener("cb:goto", navigate);
    return () => window.removeEventListener("cb:goto", navigate);
  }, []);

  useNotificationNavigation((next) => {
    if (isPage(next)) {
      setPage(next);
      if (next === "settings") setSettingSection("app");
      if (next === "profiles") setConfigTab("sources");
    }
  });

  const workspace = ["connections", "logs", "diagnostics"].includes(page)
    ? "monitor"
    : page;
  const go = (next: PageId) => {
    setPage(next);
  };
  return (
    <div className={`cb-frame ${isWindows ? "is-windows" : "is-mac"}`}>
      {!isWindows && (
        <div
          className="cb-window-drag"
          data-tauri-drag-region
          onMouseDown={dragWindow}
          aria-hidden="true"
        />
      )}
      <header className="cb-global-nav">
        <button
          className="cb-wordmark"
          onClick={() => go("home")}
          aria-label="Crossbow"
        >
          <img src={logoGlyph} alt="" draggable={false} />
          <b>Crossbow</b>
        </button>
        <nav className="cb-primary-nav" aria-label={t("studio.navigation")}>
          {(
            [
              ["home", "studio.connect"],
              ["proxies", "studio.nodes"],
              ["monitor", "studio.monitor"],
              ["profiles", "studio.config"],
              ["settings", "studio.settings"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              className={workspace === id ? "active" : ""}
              aria-current={workspace === id ? "page" : undefined}
              onClick={() => go(id === "monitor" ? "connections" : id)}
            >
              {t(label)}
            </button>
          ))}
        </nav>
        <div className="cb-global-tools">
          <button
            className="cb-source-pick"
            title={profileName || t("studio.sources")}
            onClick={() => {
              setConfigTab("sources");
              go("profiles");
            }}
          >
            <span>{profileName || t("studio.sources")}</span>
            <span aria-hidden="true">›</span>
          </button>
          <button className="cb-btn cb-diagnostics-button" onClick={() => go("diagnostics")}>
            <Icon name="pulse" />
            {t("nav.diagnostics")}
          </button>
          <NotificationHistory />
        </div>
      </header>
      <main className="cb-paper" id="main-content">
        {workspace === "monitor" && (
          <nav className="cb-subnav" aria-label={t("studio.monitor")}>
            {(
              [
                ["connections", "nav.connections"],
                ["logs", "nav.logs"],
                ["diagnostics", "nav.diagnostics"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                className={page === id ? "active" : ""}
                aria-current={page === id ? "page" : undefined}
                onClick={() => go(id)}
              >
                {t(label)}
              </button>
            ))}
          </nav>
        )}
        {page === "profiles" && (
          <nav className="cb-subnav" aria-label={t("studio.config")}>
            <button
              className={configTab === "sources" ? "active" : ""}
              onClick={() => setConfigTab("sources")}
            >
              {t("studio.sources")}
            </button>
            <button
              className={configTab === "overrides" ? "active" : ""}
              onClick={() => setConfigTab("overrides")}
            >
              {t("studio.overrides")}
            </button>
          </nav>
        )}
        <div className={`cb-page-content cb-view-${page}`}>
          {page === "home" && <HomePage />}
          {page === "proxies" && <ProxiesPage />}
          {page === "profiles" && <ProfilesPage tab={configTab} />}
          {page === "connections" && <ConnectionsPage />}
          {page === "diagnostics" && <DiagnosticsPage />}
          {page === "logs" && <LogsPage />}
          {page === "settings" && (
            <div className="cb-context-layout cb-settings-layout">
              <nav className="cb-context-nav" aria-label={t("studio.settings")}>
                <h2>{t("studio.preferences")}</h2>
                {(
                  [
                    ["network", "studio.network"],
                    ["appearance", "settings.appearance"],
                    ["logs", "settings.logsSection"],
                    ["app", "studio.application"],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    className={settingSection === id ? "active" : ""}
                    aria-current={settingSection === id ? "page" : undefined}
                    onClick={() => setSettingSection(id)}
                  >
                    {t(label)}
                  </button>
                ))}
              </nav>
              <SettingsPage section={settingSection} />
            </div>
          )}
        </div>
      </main>
      <footer className="cb-system-foot">
        <span>
          <i className={`cb-dot ${coreRunning ? "ok" : "idle"}`} />
          {coreRunning ? t("home.coreRunning") : t("home.coreStopped")} ·{" "}
          {coreLabel || t("settings.notInstalled")}
        </span>
        <span>Crossbow {appVersion && `v${appVersion}`}</span>
      </footer>
    </div>
  );
}
