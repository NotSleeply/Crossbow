import { notify } from "../notifications/service";
import { useEffect, useRef, useState } from "react";
import {
  ipc,
  type CoreBinaryInfo,
  type EngineConfigView,
  type UiSettings,
  type UpdateState,
} from "../ipc";
import Select from "../components/Select";
import { useT } from "../i18n";
import { PageHead } from "./Home";

/** 设置页（M0-S4）：内核端口/局域网、外观主题、开机自启、内核版本。 */
export default function SettingsPage({
  section = "network",
}: {
  section?: "network" | "appearance" | "logs" | "app";
}) {
  const t = useT();
  const [engine, setEngine] = useState<EngineConfigView | null>(null);
  const [portDraft, setPortDraft] = useState<string>("");
  const [theme, setTheme] = useState<UiSettings["theme"]>("system");
  const [autostart, setAutostart] = useState(false);
  const [appVersion, setAppVersion] = useState<string>("…");
  const [version, setVersion] = useState<string>("…");
  const [lang, setLangState] = useState<"zh" | "en">("zh");
  const [engineBin, setEngineBin] = useState<CoreBinaryInfo | null>(null);
  // 下拉框的本地选择（与持久化 engine 解耦：未安装的引擎也可选中）；
  // touched 前重挂载一律回显持久化引擎，避免切页后假显示另一引擎
  const [selectedEngine, setSelectedEngine] = useState<"mihomo" | "singbox">(
    "mihomo",
  );
  const selectedEngineRef = useRef<"mihomo" | "singbox">("mihomo");
  const engineTouched = useRef(false);
  selectedEngineRef.current = selectedEngine;
  const [flags, setFlags] = useState(true);
  const [tun, setTun] = useState<{ enabled: boolean; ready: boolean } | null>(
    null,
  );
  const [tunBusy, setTunBusy] = useState(false);
  // Windows 的 TUN（wintun + 特权服务）未落地前隐藏开关（#25），
  // 避免「打开无效」的困惑；落地后移除此判定
  const isMacos = navigator.userAgent.includes("Macintosh");
  const [logsSave, setLogsSave] = useState(true);
  const [logsRetention, setLogsRetention] = useState(7);
  const [autoCheck, setAutoCheck] = useState(true);
  const [autoDownload, setAutoDownload] = useState(false);
  const [updateChecked, setUpdateChecked] = useState(false);
  const [updateState, setUpdateState] = useState<UpdateState | null>(null);
  const [updateChecking, setUpdateChecking] = useState(false);
  const updateCheckInFlight = useRef(false);
  const [lightweight, setLightweight] = useState(false);
  const [installing, setInstalling] = useState<string | null>(null);

  const load = async () => {
    const e = await ipc.getEngineConfig().catch(() => null);
    setEngine(e);
    setPortDraft(e ? String(e.mixed_port) : "");
    const ui = await ipc.getUiSettings().catch(() => null);
    if (ui) {
      setLangState((ui.lang as "zh" | "en") ?? "zh");
      setLightweight(ui.lightweight_close);
    }
    setTheme(
      await ipc
        .getUiSettings()
        .then((u) => u.theme)
        .catch(() => "system" as const),
    );
    setAutostart(await ipc.autostartStatus().catch(() => false));
    if (e) setFlags(e.flag_emoji);
    setTun(await ipc.tunStatus().catch(() => null));
    const lg = await ipc.logsSettings().catch(() => null);
    if (lg) {
      setLogsSave(lg.save_enabled);
      setLogsRetention(lg.retention_days);
    }
    const u = await ipc.updateSettingsGet().catch(() => null);
    if (u) {
      setAutoCheck(u.auto_check);
      setAutoDownload(u.auto_download);
    }
    ipc
      .updateStateGet()
      .then(setUpdateState)
      .catch((e) => notify.error(e, "update-state-read"));
    // engineBin 始终跟随目标引擎（失败/成功状态归一）；
    // 用户没动过下拉框时回显持久化引擎，动过则保留本地选择
    const target = engineTouched.current
      ? selectedEngineRef.current
      : ((e?.engine as "mihomo" | "singbox") ?? "mihomo");
    setSelectedEngine(target);
    selectedEngineRef.current = target;
    const info = await ipc.coreBinaryInfoFor(target).catch(() => null);
    setEngineBin(info);
    setVersion(info?.version || t("settings.notInstalled"));
  };

  useEffect(() => {
    load();
    let alive = true;
    ipc
      .appVersion()
      .then((version) => {
        if (alive) setAppVersion(version);
      })
      .catch((error) => {
        if (alive) {
          setAppVersion("—");
          notify.error(error, "app-version-read");
        }
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const un = ipc.onTunStatus((enabled) =>
      setTun((current) => ({ enabled, ready: current?.ready ?? false })),
    );
    return () => {
      void un.then((off) => off());
    };
  }, []);

  useEffect(() => {
    const un = ipc.onUpdateState((state) => {
      setUpdateState(state);
    });
    return () => {
      void un.then((off) => off());
    };
  }, []);

  const saving = useRef(new Set<string>());
  const saveSetting = async (
    key: string,
    title: string,
    task: () => Promise<unknown>,
    commit: () => void,
    success?: string,
  ) => {
    if (saving.current.has(key)) return;
    saving.current.add(key);
    try {
      const result = await notify.run(`setting-${key}`, title, task, success, {
        feedback: "error-only",
        titleKey:
          (
            {
              logs: "settings.logsSave",
              retention: "settings.logsRetention",
              "auto-check": "settings.autoCheck",
              "auto-download": "settings.autoDownload",
            } as Record<string, string>
          )[key] ?? `settings.${key}`,
      });
      if (result.ok) commit();
      else await load();
    } finally {
      saving.current.delete(key);
    }
  };

  const runUpdateCheck = async () => {
    if (updateCheckInFlight.current) return;
    updateCheckInFlight.current = true;
    setUpdateChecking(true);

    try {
      const version = await ipc.updateCheckNow();
      const state = await ipc.updateStateGet();
      setUpdateState(
        state ??
          (version
            ? { version, notes: null, downloaded: false, progress: null }
            : null),
      );
      setUpdateChecked(true);
      void notify.resolve("update-check");
    } catch (error) {
      notify.error(
        String(error) === "UPDATE_CHECK_TIMEOUT"
          ? t("settings.updateTimeout")
          : error,
        "update-check",
        t("settings.updateFailed"),
      );
    } finally {
      updateCheckInFlight.current = false;
      setUpdateChecking(false);
    }
  };

  const applyPort = async () => {
    const port = Number(portDraft);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) {
      notify.error(
        t("settings.invalidPort"),
        "setting-port",
        t("settings.port"),
      );
      return;
    }
    if (port === engine?.mixed_port) return;
    await saveSetting(
      "port",
      t("settings.port"),
      () => ipc.setMixedPort(port),
      () => {
        setEngine((old) => (old ? { ...old, mixed_port: port } : old));
      },
      `${t("settings.port")}: ${port}`,
    );
  };

  return (
    <div className={`cb-settings-page cb-settings-${section}`}>
      <PageHead title={t("settings.title")} />

      {section === "network" && (
        <Group title={t("settings.coreSection")}>
          <Row label={t("settings.engine")} hint={t("settings.engineHint")}>
            <Select
              value={selectedEngine}
              onChange={(v) => {
                // 仅更新本地选择：安装状态随所选引擎显示；
                // 已安装的引擎在下载行位置出现「启用」按钮
                const val = v as "mihomo" | "singbox";
                engineTouched.current = true;
                setSelectedEngine(val);
                void ipc
                  .coreBinaryInfoFor(val)
                  .then((info) => {
                    setEngineBin(info);
                    setVersion(info?.version || t("settings.notInstalled"));
                  })
                  .catch((e) => notify.error(e, "engine-info"));
              }}
              options={[
                { value: "mihomo", label: "mihomo (Clash Meta)" },
                { value: "singbox", label: "sing-box" },
              ]}
            />
          </Row>
          {engineBin?.source === "missing" ? (
            <Row
              label={t("settings.coreMissingEngine", {
                engine: selectedEngine,
              })}
            >
              <button
                disabled={installing !== null}
                onClick={async () => {
                  if (installing !== null) return;
                  setInstalling("starting…");
                  try {
                    const info = await ipc.coreInstall(selectedEngine);
                    setEngineBin(info);
                    setVersion(info.version || t("settings.coreReady"));
                    // Activation has its own lifecycle after the download completes.
                    await saveSetting(
                      "engine",
                      t("settings.engine"),
                      () => ipc.setEngine(selectedEngine),
                      () => {
                        void load();
                      },
                    );
                  } catch (e) {
                    // 失败：回下载行（engineBin 重新查询所选引擎 → 仍是 missing）
                    notify.error(
                      e,
                      "core-download",
                      t("settings.downloadCore"),
                    );
                  } finally {
                    setInstalling(null);
                    setEngineBin(
                      await ipc
                        .coreBinaryInfoFor(selectedEngineRef.current)
                        .catch(() => null),
                    );
                    await load();
                  }
                }}
                className="cb-btn acc px-3 py-1.5"
              >
                {installing ?? t("settings.downloadCore")}
              </button>
            </Row>
          ) : (
            selectedEngine !== (engine?.engine ?? "mihomo") && (
              <Row
                label={t("settings.engineApply", { engine: selectedEngine })}
              >
                <button
                  className="cb-btn acc px-3 py-1.5"
                  onClick={async () => {
                    await saveSetting(
                      "engine",
                      t("settings.engine"),
                      () => ipc.setEngine(selectedEngine),
                      () => {
                        void load();
                      },
                    );
                  }}
                >
                  启用
                </button>
              </Row>
            )
          )}
          <Row label={t("settings.version")} hint={selectedEngine}>
            <span
              className="cb-selectable text-xs"
              style={{ color: "var(--cb-text-dim)" }}
            >
              {engineBin?.source === "missing"
                ? t("settings.notInstalled")
                : version}
            </span>
          </Row>
          <Row label={t("settings.port")} hint={t("settings.portHint")}>
            <input
              value={portDraft}
              onChange={(e) => setPortDraft(e.target.value)}
              onBlur={applyPort}
              onKeyDown={(e) => e.key === "Enter" && applyPort()}
              className="cb-input cb-selectable w-24 px-2 py-1"
            />
          </Row>
          <Row label={t("settings.flags")} hint={t("settings.flagsHint")}>
            <Switch
              checked={flags}
              onChange={async (v) => {
                await saveSetting(
                  "flags",
                  t("settings.flags"),
                  () => ipc.setFlagEmoji(v),
                  () => setFlags(v),
                );
              }}
            />
          </Row>
          <Row
            label={t("settings.tun")}
            hint={tunBusy ? t("settings.tunSwitching") : t("settings.tunHint")}
          >
            <div className="flex items-center gap-2">
              {tunBusy && (
                <svg
                  className="h-3 w-3 animate-spin"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden="true"
                >
                  <path d="M21 12a9 9 0 1 1-9-9" strokeLinecap="round" />
                </svg>
              )}
              {tunBusy && (
                <span className="text-xs text-[var(--cb-text-dim)]">
                  {t("settings.tunSwitching")}
                </span>
              )}
              <Switch
                checked={tun?.enabled ?? false}
                disabled={tunBusy}
                onChange={async (v) => {
                  if (tunBusy) return;
                  setTunBusy(true);
                  try {
                    await ipc.setTun(v);
                    setTun(await ipc.tunStatus());
                  } catch {
                    // setTun publishes its result in the backend.
                  } finally {
                    await load();
                    setTunBusy(false);
                  }
                }}
              />
            </div>
          </Row>
          {isMacos && tun?.enabled && (
            <Row
              label={t("settings.tunState")}
              hint={t("settings.tunStateHint")}
            >
              <span
                className="text-xs"
                style={{ color: tun.ready ? "var(--cb-ok)" : "var(--cb-warn)" }}
              >
                {tun.ready ? t("settings.tunReady") : t("settings.tunNeedAuth")}
              </span>
            </Row>
          )}
          <Row label={t("settings.lan")} hint={t("settings.lanHint")}>
            <Switch
              checked={engine?.allow_lan ?? false}
              onChange={async (v) => {
                await saveSetting(
                  "lan",
                  t("settings.lan"),
                  () => ipc.setAllowLan(v),
                  () => {
                    void load();
                  },
                  v ? t("settings.lanOn") : t("settings.lanOff"),
                );
              }}
            />
          </Row>
        </Group>
      )}

      {section === "appearance" && (
        <Group title={t("settings.appearance")}>
          <Row label={t("settings.theme")}>
            <Select
              value={theme}
              options={[
                { value: "system", label: t("theme.system") },
                { value: "light", label: t("theme.light") },
                { value: "dark", label: t("theme.dark") },
              ]}
              onChange={async (v) => {
                const next = v as UiSettings["theme"];
                await saveSetting(
                  "theme",
                  t("settings.theme"),
                  () => ipc.setTheme(next),
                  () => setTheme(next),
                );
              }}
            />
          </Row>
          <Row label={t("settings.lang")}>
            <Select
              value={lang}
              options={[
                { value: "zh", label: "简体中文" },
                { value: "en", label: "English" },
              ]}
              onChange={async (v) => {
                const l = v as "zh" | "en";
                await saveSetting(
                  "lang",
                  t("settings.lang"),
                  () => ipc.setLang(l),
                  () => setLangState(l),
                );
              }}
            />
          </Row>
        </Group>
      )}

      {section === "logs" && (
        <Group title={t("settings.logsSection")}>
          <Row label={t("settings.logsSave")} hint={t("settings.logsSaveHint")}>
            <Switch
              checked={logsSave}
              onChange={async (v) => {
                await saveSetting(
                  "logs",
                  t("settings.logsSave"),
                  () => ipc.setLogsSave(v),
                  () => setLogsSave(v),
                );
              }}
            />
          </Row>
          <Row
            label={t("settings.logsRetention")}
            hint={t("settings.logsRetentionHint")}
          >
            <Select
              value={String(logsRetention)}
              options={[1, 3, 5, 7, 15, 30].map((d) => ({
                value: String(d),
                label: `${d} ${t("settings.logsDays")}`,
              }))}
              onChange={async (v) => {
                const d = Number(v);
                await saveSetting(
                  "retention",
                  t("settings.logsRetention"),
                  () => ipc.setLogsRetention(d),
                  () => setLogsRetention(d),
                );
              }}
            />
          </Row>
          <Row label={t("settings.logsOpen")} hint={t("settings.logsOpenHint")}>
            <button
              className="cb-btn"
              onClick={() =>
                ipc.openLogsDir().catch((e) => notify.error(e, "open-logs"))
              }
            >
              {t("settings.logsOpenBtn")}
            </button>
          </Row>
        </Group>
      )}

      {section === "app" && (
        <Group title={t("settings.systemSection")}>
          <Row
            label={t("settings.lightweight")}
            hint={t("settings.lightweightHint")}
          >
            <Switch
              checked={lightweight}
              onChange={async (v) => {
                await saveSetting(
                  "lightweight",
                  t("settings.lightweight"),
                  () => ipc.setLightweightClose(v),
                  () => setLightweight(v),
                );
              }}
            />
          </Row>
          <Row
            label={t("settings.autostart")}
            hint={t("settings.autostartHint")}
          >
            <Switch
              checked={autostart}
              onChange={async (v) => {
                await saveSetting(
                  "autostart",
                  t("settings.autostart"),
                  () => ipc.autostartSet(v),
                  () => setAutostart(v),
                  v ? t("settings.autostartOn") : t("settings.autostartOff"),
                );
              }}
            />
          </Row>
          <Row
            label={t("settings.snapshot")}
            hint={t("settings.snapshotAuto")}
          />
          <Row label={t("settings.appVersion")} hint="Crossbow">
            <span
              className="text-xs tabular-nums"
              style={{ fontFamily: "var(--cb-mono)", color: "var(--cb-text)" }}
            >
              {appVersion === "…" || appVersion === "—"
                ? appVersion
                : `v${appVersion}`}
            </span>
          </Row>
          <Row
            label={t("settings.autoCheck")}
            hint={t("settings.autoCheckHint")}
          >
            <Switch
              checked={autoCheck}
              onChange={async (v) => {
                await saveSetting(
                  "auto-check",
                  t("settings.autoCheck"),
                  () => ipc.setUpdateAutoCheck(v),
                  () => setAutoCheck(v),
                );
              }}
            />
          </Row>
          <Row
            label={t("settings.autoDownload")}
            hint={t("settings.autoDownloadHint")}
          >
            <Switch
              checked={autoDownload}
              onChange={async (v) => {
                await saveSetting(
                  "auto-download",
                  t("settings.autoDownload"),
                  () => ipc.setUpdateAutoDownload(v),
                  () => setAutoDownload(v),
                );
              }}
            />
          </Row>
          <Row
            label={t("settings.updateNow")}
            hint={
              updateState
                ? updateState.downloaded
                  ? t("settings.updateReady")
                  : updateState.progress
                    ? `${t("settings.updateProgress")} ${Math.round(
                        (updateState.progress[0] /
                          Math.max(updateState.progress[1], 1)) *
                          100,
                      )}%`
                    : t("settings.newVersion", { v: updateState.version })
                : updateChecked
                  ? t("settings.upToDate")
                  : undefined
            }
          >
            <div className="flex max-w-[240px] flex-col items-end gap-1.5">
              <div className="flex items-center gap-2">
                {(updateState === null || updateChecking) && (
                  <button
                    className="cb-btn inline-flex items-center gap-1.5 py-1.5"
                    onClick={runUpdateCheck}
                    disabled={updateChecking}
                    aria-busy={updateChecking}
                  >
                    {updateChecking && (
                      <svg
                        className="h-3 w-3 animate-spin"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        aria-hidden="true"
                      >
                        <path d="M21 12a9 9 0 1 1-9-9" strokeLinecap="round" />
                      </svg>
                    )}
                    {t(
                      updateChecking
                        ? "settings.updateChecking"
                        : "settings.checkUpdateBtn",
                    )}
                  </button>
                )}
                {updateState && !updateState.downloaded && !updateChecking && (
                  <button
                    className="cb-btn py-1.5"
                    disabled={updateState.progress !== null}
                    onClick={() =>
                      ipc
                        .updateStartDownload()
                        .catch((e) => notify.error(e, "update-download"))
                    }
                  >
                    {t("settings.updateDownload")}
                  </button>
                )}
                {updateState?.downloaded && !updateChecking && (
                  <button
                    className="cb-btn py-1.5"
                    style={{ color: "var(--cb-accent)" }}
                    onClick={() =>
                      notify.run(
                        "update-install",
                        t("settings.updateRestart"),
                        () => ipc.updateInstall(),
                      )
                    }
                  >
                    {t("settings.updateRestart")}
                  </button>
                )}
              </div>
            </div>
          </Row>
        </Group>
      )}
    </div>
  );
}

function Group({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    // 不能加 overflow-hidden：会把组内 Select 的绝对定位弹层在卡片边界裁掉
    <section className="cb-settings-group">
      <div
        className="border-b px-4 py-2.5 cb-micro"
        style={{ borderColor: "var(--cb-line)" }}
      >
        {title}
      </div>
      <div className="cb-rows">{children}</div>
    </section>
  );
}

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      className="cb-setting-row flex items-center justify-between"
      role="group"
      title={hint}
      aria-label={label}
    >
      <div>
        <div className="text-sm">{label}</div>
        {hint && (
          <div
            className="cb-setting-hint mt-0.5 text-xs"
            title={hint}
            style={{ color: "var(--cb-text-dim)" }}
          >
            {hint}
          </div>
        )}
      </div>
      {children}
    </div>
  );
}

function Switch({
  checked,
  onChange,
  disabled = false,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`cb-toggle ${checked ? "on" : ""} ${disabled ? "opacity-60 cursor-wait" : ""}`}
    />
  );
}
