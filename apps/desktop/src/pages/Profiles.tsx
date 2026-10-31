import { Button, ButtonBase } from "../components/Button";
import { notify } from "../notifications/service";
import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { ipc, type Profile } from "../ipc";
import Select from "../components/Select";
import OverridePanel from "./OverridePanel";
import { useT } from "../i18n";
import FitItems from "../components/FitItems";
import Dialog from "../components/Dialog";
import { Icon } from "../components/Icon";
import { ProgressRing } from "../components/ProgressRing";
import { PageHead } from "./Home";

function fmtBytesLocal(n: number): string {
  if (n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(
    Math.floor(Math.log(n) / Math.log(1024)),
    units.length - 1,
  );
  return `${(n / 1024 ** i).toFixed(1)} ${units[i]}`;
}

function fmtTime(
  ts: number | null | undefined,
  t: (
    k: "profiles.justNow" | "profiles.minAgo" | "profiles.hourAgo",
    p?: Record<string, number>,
  ) => string,
): string {
  if (!ts) return "—";
  const diff = Date.now() / 1000 - ts;
  if (diff < 60) return t("profiles.justNow");
  if (diff < 3600) return t("profiles.minAgo", { n: Math.floor(diff / 60) });
  if (diff < 86400)
    return t("profiles.hourAgo", { n: Math.floor(diff / 3600) });
  return new Date(ts * 1000).toLocaleDateString();
}

/** 配置页：订阅导入（URL）、更新、激活、删除；覆写链在 M0-S3 接入。 */
export default function ProfilesPage({
  tab = "sources",
}: {
  tab?: "sources" | "overrides";
}) {
  const t = useT();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    setProfiles(await ipc.listProfiles().catch(() => []));
    setActiveId(await ipc.activeProfileId().catch(() => null));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // 后台调度器完成自动更新后刷新列表
  useEffect(() => {
    const un = ipc.onProfileUpdated(() => refresh());
    return () => void un.then((f) => f());
  }, [refresh]);

  const importPaths = useCallback(
    async (paths: string[]) => {
      for (const p of paths) {
        await run2(p, () => ipc.importProfileFile(p));
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useEffect(() => {
    let un: (() => void) | undefined;
    let disposed = false;
    getCurrentWebview()
      .onDragDropEvent((event) => {
        if (event.payload.type === "enter" || event.payload.type === "over") {
          setDragOver(true);
        } else if (event.payload.type === "leave") {
          setDragOver(false);
        } else if (event.payload.type === "drop") {
          setDragOver(false);
          void importPaths(event.payload.paths);
        }
      })
      .then((u) => {
        if (disposed) u();
        else un = u;
      })
      .catch((error) => notify.error(error, "profile-file-import"));
    return () => {
      disposed = true;
      un?.();
    };
  }, [importPaths]);

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    try {
      await notify.run(`profile-${key}`, t("profiles.title"), fn, undefined, {
        feedback: /^(update|activate|remove|interval|rename)-/.test(key)
          ? "error-only"
          : "task",
        titleKey: "profiles.title",
      });
      await refresh();
    } finally {
      setBusy(null);
    }
  };
  const run2 = run;

  const chosenFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    for (const f of Array.from(files)) {
      await run(f.name, async () => {
        const text = await f.text();
        return ipc.importProfileContent(f.name.replace(/\.[^.]+$/, ""), text);
      });
    }
    // 导入完成后与 URL 导入一致：自动关闭弹窗（失败会以通知卡提示，可重开重试）
    setImporting(false);
  };

  const selected =
    profiles.find((p) => p.id === selectedId) ??
    profiles.find((p) => p.id === activeId) ??
    profiles[0];
  const importUrl = () =>
    run("import", async () => {
      await ipc.importProfileUrl(url.trim());
      setUrl("");
      setImporting(false);
    });
  return (
    <div className="cb-profiles-page">
      <PageHead
        title={t(tab === "overrides" ? "studio.overrides" : "studio.sources")}
        meta={t("studio.configHint")}
      >
        {tab === "sources" && (
          <Button onClick={() => setImporting(true)}>
            <Icon name="download" />
            {t("studio.importSource")}
          </Button>
        )}
      </PageHead>
      <input
        ref={fileInputRef}
        type="file"
        accept=".yaml,.yml,.txt,.conf"
        multiple
        hidden
        onChange={(e) => {
          void chosenFiles(e.target.files);
          e.target.value = "";
        }}
      />
      {dragOver && (
        <div className="cb-drop-indicator">{t("profiles.dropHint")}</div>
      )}
      {tab === "overrides" ? (
        <OverridePanel
          profiles={profiles}
          activeId={activeId}
          onChanged={refresh}
        />
      ) : profiles.length === 0 ? (
        <div className="cb-empty">
          <Icon name="document" size={26} />
          <h2>{t("profiles.empty")}</h2>
          <p>{t("profiles.dropHint")}</p>
          <Button className="mt-4" onClick={() => setImporting(true)}>
            {t("studio.importSource")}
          </Button>
        </div>
      ) : (
        <div className="cb-context-layout">
          <nav className="cb-context-nav" aria-label={t("studio.sources")}>
            <h2>{t("studio.sources")}</h2>
            <FitItems
              items={profiles}
              rowHeight={64}
              label={t("studio.sources")}
              render={(profile) => (
                <ButtonBase
                  key={profile.id}
                  className={`cb-profile-list-item ${profile.id === selected?.id ? "active" : ""}`}
                  aria-current={
                    profile.id === selected?.id ? "page" : undefined
                  }
                  onClick={() => setSelectedId(profile.id)}
                >
                  <span>{profile.name}</span>
                  <small>
                    {profile.kind === "remote"
                      ? t("profiles.remote")
                      : t("profiles.local")}
                    {profile.id === activeId
                      ? ` · ${t("profiles.current")}`
                      : ""}
                  </small>
                </ButtonBase>
              )}
            />
          </nav>
          <div className="cb-profile-detail">
            {selected && (
              <ProfileCard
                key={selected.id}
                profile={selected}
                active={selected.id === activeId}
                busy={busy !== null}
                onUpdate={() =>
                  run(`update-${selected.id}`, () =>
                    ipc.updateProfile(selected.id),
                  )
                }
                onActivate={() =>
                  run(`activate-${selected.id}`, () =>
                    ipc.setActiveProfile(selected.id),
                  )
                }
                onRemove={() =>
                  run(`remove-${selected.id}`, () =>
                    ipc.removeProfile(selected.id),
                  )
                }
                onSetInterval={(min) =>
                  run(`interval-${selected.id}`, () =>
                    ipc.setProfileInterval(selected.id, min),
                  )
                }
                onRename={(name) =>
                  run(`rename-${selected.id}`, () =>
                    ipc.renameProfile(selected.id, name),
                  )
                }
              />
            )}
          </div>
        </div>
      )}
      {importing && (
        <Dialog
          title={t("studio.importSource")}
          onClose={() => setImporting(false)}
        >
          <p className="cb-control-note">{t("profiles.dropHint")}</p>
          <label htmlFor="profile-url">{t("profiles.urlPlaceholder")}</label>
          <input
            id="profile-url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && url.trim() && busy === null)
                void importUrl();
            }}
            className="cb-input cb-selectable"
          />
          <div className="actions">
            <Button
              disabled={busy !== null}
              onClick={() => fileInputRef.current?.click()}
            >
              {t("profiles.importFile")}
            </Button>
            <Button variant="primary"
              disabled={!url.trim() || busy !== null}
              onClick={importUrl}
            >
              {busy === "import"
                ? t("profiles.importing")
                : t("profiles.import")}
            </Button>
          </div>
        </Dialog>
      )}
    </div>
  );
}

function nextUpdateText(profile: Profile, t: ReturnType<typeof useT>): string {
  const lu = profile.last_update;
  if (lu && !lu.ok) {
    return t("profiles.updateFailedAt", {
      detail: (lu.detail ?? "?").slice(0, 80),
    });
  }
  const interval = profile.update_interval_min * 60;
  const last = profile.last_updated ?? 0;
  const next = last + interval;
  const time = new Date(next * 1000).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  return t("profiles.nextAt", { time });
}

function ProfileCard({
  profile,
  active,
  busy,
  onUpdate,
  onActivate,
  onRemove,
  onSetInterval,
  onRename,
}: {
  profile: Profile;
  active: boolean;
  busy: boolean;
  onUpdate: () => void;
  onActivate: () => void;
  onRemove: () => void;
  onSetInterval: (min: number) => void;
  onRename: (name: string) => void;
}) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const cancelRename = useRef(false);
  const [nameDraft, setNameDraft] = useState(profile.name);
  const traffic = profile.traffic;
  const used = traffic ? traffic.upload + traffic.download : 0;
  const pct =
    traffic && traffic.total > 0
      ? Math.min(100, (used / traffic.total) * 100)
      : 0;

  return (
    <section>
      <div className="flex flex-wrap items-center gap-3">
        {editing ? (
          <input
            autoFocus
            className="cb-input cb-selectable"
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={() => {
              setEditing(false);
              if (cancelRename.current) {
                cancelRename.current = false;
                return;
              }
              if (nameDraft.trim() && nameDraft !== profile.name)
                onRename(nameDraft.trim());
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") {
                cancelRename.current = true;
                setNameDraft(profile.name);
                setEditing(false);
              }
            }}
          />
        ) : (
          <h2 className="text-xl font-medium cb-selectable">{profile.name}</h2>
        )}
        <Button
          disabled={busy}
          onClick={() => {
            cancelRename.current = false;
            setNameDraft(profile.name);
            setEditing(true);
          }}
        >
          {t("profiles.rename")}
        </Button>
        {active && <span className="cb-badge">{t("profiles.current")}</span>}
      </div>
      <dl className="cb-profile-facts">
        <div>
          <dt>{t("studio.sources")}</dt>
          <dd>
            {profile.kind === "remote"
              ? t("profiles.remote")
              : t("profiles.local")}
          </dd>
        </div>
        <div>
          <dt>{t("profiles.updatedAt", { time: "" })}</dt>
          <dd>{fmtTime(profile.last_updated, t)}</dd>
        </div>
        <div>
          <dt>{t("studio.overrides")}</dt>
          <dd>{profile.override_ids.length}</dd>
        </div>
        <div>
          <dt>{t("profiles.current")}</dt>
          <dd>{active ? t("profiles.current") : "—"}</dd>
        </div>
      </dl>
      {profile.kind === "remote" && (
        <div className="cb-setting-row flex items-center justify-between">
          <div>
            <div className="text-sm">{t("profiles.remote")}</div>
            {profile.update_interval_min > 0 && (
              <p className="cb-control-note">{nextUpdateText(profile, t)}</p>
            )}
          </div>
          <Select
            label={t("profiles.autoUpdate")}
            value={profile.update_interval_min}
            options={[
              { value: 0, label: t("profiles.autoOff") },
              ...[360, 720, 1440].map((min) => ({
                value: min,
                label: t("profiles.autoH", { n: min / 60 }),
              })),
            ]}
            onChange={(value) => onSetInterval(Number(value))}
          />
        </div>
      )}
      <div className="cb-profile-actions">
        <div>
          {traffic && traffic.total > 0 && (
            <>
              <ProgressRing
                size={44}
                value={pct}
                label={`${Math.round(pct)}%`}
              />
              <p className="text-[13px] tabular-nums">
                {fmtBytesLocal(used)} / {fmtBytesLocal(traffic.total)}
              </p>
            </>
          )}
        </div>
        <div>
          {profile.kind === "remote" && (
            <Button disabled={busy} onClick={onUpdate}>
              {t("profiles.update")}
            </Button>
          )}
          {!active && (
            <Button variant="primary"
              disabled={busy}
              onClick={onActivate}
            >
              {t("profiles.setActive")}
            </Button>
          )}
          <Button
            tone="danger"
            disabled={busy}
            onClick={onRemove}
          >
            {t("profiles.remove")}
          </Button>
        </div>
      </div>
    </section>
  );
}
