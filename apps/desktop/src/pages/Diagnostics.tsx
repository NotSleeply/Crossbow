import { notify } from "../notifications/service";
import { useState } from "react";
import { ipc, type CheckResult } from "../ipc";
import { useT } from "../i18n";
import { PageHead } from "./Home";
import { Icon } from "../components/Icon";

/** 网络诊断页（M1.2）：一键自检 + 可执行修复动作。 */
export default function DiagnosticsPage() {
  const t = useT();
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<CheckResult[] | null>(null);
  const [fixing, setFixing] = useState<string | null>(null);

  const run = async () => {
    if (running) return;
    setRunning(true);

    try {
      const checks = await ipc.runDiagnosis();
      setResults(checks);
      void notify.resolve("diagnostics-operation");
    } catch (e) {
      notify.error(e, "diagnostics-operation");
    } finally {
      setRunning(false);
    }
  };

  const applyFix = async (check: CheckResult) => {
    if (!check.fix) return;
    setFixing(check.id);
    const backendOwnsNotice = check.fix === "toggle_sysproxy";

    try {
      if (check.fix === "start_core") await ipc.coreStart();
      if (check.fix === "restart_core") {
        try {
          await ipc.coreStop();
        } catch {
          // The backend already reported this failure. Do not start another core.
          return;
        }
        await new Promise((r) => setTimeout(r, 500));
        await ipc.coreStart();
      }
      if (check.fix === "toggle_sysproxy") await ipc.sysproxyToggle();
      if (!backendOwnsNotice) void notify.resolve("diagnostics-fix");
    } catch (e) {
      if (!backendOwnsNotice) notify.error(e, "diagnostics-fix");
    } finally {
      setFixing(null);
      void run(); // 修复后自动重跑
    }
  };

  const applicable = results?.filter((r) => !r.skipped);
  const allOk = applicable && applicable.length > 0 && applicable.every((r) => r.ok);

  return (
    <div className="cb-diagnostics-page">
      <PageHead title={t("diag.title")} meta={t("diag.hint")}>
        <button className="cb-btn acc" onClick={run} disabled={running}>
          {running ? t("diag.running") : t("diag.run")}
        </button>
      </PageHead>

      {results === null ? (
        <div
          className="cb-card flex h-56 flex-col items-center justify-center gap-2 text-sm"
          style={{ color: "var(--cb-text-dim)" }}
        >
          <Icon name="pulse" size={20} stroke="var(--cb-faint)" />
          <span>{t("diag.hint")}</span>
        </div>
      ) : (
        <div className="cb-diag-results">
          <div className="cb-diag-summary">
            <span style={{ color: allOk ? "var(--cb-ok)" : "var(--cb-warn)" }}>
              {applicable?.filter((result) => result.ok).length}/{applicable?.length}
            </span>
            <div>
              <h2>{allOk ? t(results.some((r) => r.skipped) ? "diag.applicableOk" : "diag.allOk") : t("diag.title")}</h2>
            </div>
          </div>
          {results.map((r) => (
            <section
              key={r.id}
              className="cb-card flex items-center gap-3 px-4 py-3"
            >
              <i className={`cb-dot flex-none ${r.skipped ? "idle" : r.ok ? "ok" : "bad"}`} />
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium">
                  {t(`check.${r.id}` as const)}
                </div>
                {!r.ok && (
                  <div
                    className="cb-selectable mt-0.5 text-[11.5px]"
                    title={r.detail}
                    style={{ color: "var(--cb-text-dim)" }}
                  >
                    {r.detail}
                  </div>
                )}
              </div>
              {r.skipped ? (
                <span className="text-xs" style={{ color: "var(--cb-text-dim)" }}>{t("diag.notApplicable")}</span>
              ) : r.ok ? (
                <span
                  className="cb-mono text-[11px]"
                  style={{ color: "var(--cb-text-dim)" }}
                >
                  OK
                </span>
              ) : r.fix ? (
                <button
                  className="cb-btn acc py-1.5"
                  disabled={fixing !== null}
                  onClick={() => applyFix(r)}
                >
                  {fixing === r.id ? "…" : t(`diag.fix.${r.fix}` as const)}
                </button>
              ) : null}
            </section>
          ))}

        </div>
      )}
    </div>
  );
}
