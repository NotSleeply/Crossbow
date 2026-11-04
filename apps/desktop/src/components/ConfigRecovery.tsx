import { useEffect, useRef, useState } from "react";
import { Button } from "./Button";
import Dialog from "./Dialog";
import { ipc, type ConfigSnapshot } from "../ipc";
import { notify } from "../notifications/service";
import { useT } from "../i18n";
export default function ConfigRecovery({
  onClose,
  onRestored,
}: {
  onClose: () => void;
  onRestored: () => void;
}) {
  const t = useT(),
    alive = useRef(true),
    restoring = useRef(false);
  const [rows, setRows] = useState<ConfigSnapshot[]>([]),
    [phase, setPhase] = useState("loading"),
    [chosen, setChosen] = useState<ConfigSnapshot | null>(null),
    [busy, setBusy] = useState(false);
  const load = async () => {
    setPhase("loading");
    try {
      const rows = await ipc.configSnapshots();
      if (alive.current) {
        setRows(rows);
        setPhase("ready");
      }
    } catch (e) {
      if (alive.current) {
        setPhase("error");
        notify.error(e, "snapshot-list");
      }
    }
  };
  useEffect(() => {
    alive.current = true;
    void load();
    return () => {
      alive.current = false;
    };
  }, []);
  const restore = async () => {
    if (!chosen || restoring.current) return;
    restoring.current = true;
    setBusy(true);
    const r = await notify.run(
      "snapshot-restore",
      t("backup.title"),
      () => ipc.restoreConfigSnapshot(chosen.id),
      t("backup.done"),
    );
    if (r.ok) {
      onRestored();
      onClose();
    } else {
      restoring.current = false;
      if (alive.current) setBusy(false);
    }
  };
  return (
    <Dialog title={t(chosen ? "backup.confirm" : "backup.title")} onClose={onClose}>
      <p className="cb-control-note">{t(chosen ? "backup.impact" : "backup.hint")}</p>
      {chosen ? (
        <section className="cb-recovery-confirm">
          <h3>{new Date(chosen.at * 1000).toLocaleString()}</h3>
          <p>{t("backup.counts", { profiles: chosen.profiles, overrides: chosen.overrides })}</p>
          <p className="cb-selectable">{chosen.active ?? "—"}</p>
          <div className="actions">
            <Button disabled={busy} onClick={() => setChosen(null)}>
              {t("workflow.back")}
            </Button>
            <Button variant="primary" loading={busy} disabled={busy} onClick={() => void restore()}>
              {t("backup.restore")}
            </Button>
          </div>
        </section>
      ) : phase === "loading" ? (
        <p role="status">{t("workflow.loading")}</p>
      ) : phase === "error" ? (
        <Button onClick={() => void load()}>{t("home.retryState")}</Button>
      ) : rows.length === 0 ? (
        <p>{t("backup.empty")}</p>
      ) : (
        <div className="cb-recovery-list">
          {rows.map((row) => (
            <section key={row.id}>
              <div>
                <h3>{new Date(row.at * 1000).toLocaleString()}</h3>
                <p>{t("backup.counts", { profiles: row.profiles, overrides: row.overrides })}</p>
                <p className="cb-selectable">{row.active ?? "—"}</p>
              </div>
              <Button size="small" onClick={() => setChosen(row)}>
                {t("backup.restore")}
              </Button>
            </section>
          ))}
        </div>
      )}
    </Dialog>
  );
}
