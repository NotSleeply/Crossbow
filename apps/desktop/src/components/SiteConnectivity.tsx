import "./SiteConnectivity.css";
import { useEffect, useRef, useState } from "react";
import { ipc, type SiteResult } from "../ipc";
import { useT } from "../i18n";
import { notify } from "../notifications/service";
import { ProgressRing } from "./ProgressRing";

const SITES = [
  { id: "youtube", name: "YouTube", host: "youtube.com" },
  { id: "x", name: "X / Twitter", host: "x.com" },
  { id: "google", name: "Google", host: "google.com" },
  { id: "github", name: "GitHub", host: "github.com" },
];

export default function SiteConnectivity({
  contextKey,
}: {
  contextKey: string;
}) {
  const t = useT();
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [results, setResults] = useState<Record<string, SiteResult>>({});
  const inFlight = useRef(false);
  const mounted = useRef(false);
  const generation = useRef(0);
  const coreState = useRef<string | null>(null);
  const invalidate = () => {
    generation.current++;
    inFlight.current = false;
    setBusy(new Set());
    setResults({});
  };
  useEffect(invalidate, [contextKey]);
  useEffect(() => {
    mounted.current = true;
    let receivedEvent = false;
    let alive = true;
    const receive = (status: { state: string }) => {
      if (!alive) return;
      if (coreState.current !== status.state) {
        coreState.current = status.state;
        invalidate();
      }
      setRunning(status.state === "Running");
    };
    void ipc
      .coreStatus()
      .then((status) => {
        if (!receivedEvent) receive(status);
      })
      .catch((error) => {
        if (alive) notify.error(error, "sites-core-state");
      });
    const off = ipc.onCoreStatus((status) => {
      receivedEvent = true;
      receive(status);
    });
    return () => {
      alive = false;
      mounted.current = false;
      void off.then((unlisten) => unlisten());
    };
  }, []);

  const test = async (ids: string[]) => {
    if (inFlight.current || !running) return;
    inFlight.current = true;
    setBusy(new Set(ids));
    setResults((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([id]) => !ids.includes(id)),
      ),
    );
    const currentGeneration = generation.current;
    const failures: unknown[] = [];
    try {
      await Promise.all(
        ids.map(async (id) => {
          let result: SiteResult;
          try {
            result = await ipc.testSite(id);
          } catch (error) {
            failures.push(error);
            result = {
              id,
              status: "error",
              http_status: null,
              latency_ms: null,
              error: "network",
            };
          }
          if (mounted.current && generation.current === currentGeneration) {
            setResults((current) => ({ ...current, [id]: result }));
            setBusy((current) => {
              const next = new Set(current);
              next.delete(id);
              return next;
            });
          }
          return result;
        }),
      );
      if (generation.current !== currentGeneration) return;
      // 结果原位刷新即反馈（#140）；仅命令级失败按约定保留 error
      if (failures.length) {
        const operation = `site-test-${crypto.randomUUID()}`;
        notify.error(
          failures.map(String).join("; "),
          operation,
          t("sites.done"),
        );
      }
    } finally {
      if (generation.current === currentGeneration) {
        inFlight.current = false;
        if (mounted.current) setBusy(new Set());
      }
    }
  };

  return (
    <section className="cb-site-section" aria-label={t("sites.title")}>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div>
          <h2 className="text-[13px] font-semibold">{t("sites.title")}</h2>
          <p
            className="text-[11px] mt-1"
            style={{ color: "var(--cb-text-dim)" }}
          >
            {t("sites.hint")}
          </p>
        </div>
        <button
          className="cb-btn"
          disabled={!running || busy.size > 0}
          onClick={() => void test(SITES.map((site) => site.id))}
        >
          {busy.size ? t("sites.testing") : t("sites.testAll")}
        </button>
      </div>
      <div className="cb-site-grid">
        {SITES.map((site) => {
          const result = results[site.id];
          const pending = busy.has(site.id);
          const text = pending
            ? t("sites.testing")
            : !result
              ? t("sites.untested")
              : result.status === "ok"
                ? t("sites.available")
                : result.status === "restricted" ||
                    result.status === "http_error"
                  ? `HTTP ${result.http_status}`
                  : t(`sites.error.${result.error ?? "network"}`);
          const color = pending
            ? "var(--cb-accent)"
            : result?.status === "ok"
              ? "var(--cb-ok)"
              : result?.status === "restricted" ||
                  result?.status === "http_error"
                ? "var(--cb-warn)"
                : result
                  ? "var(--cb-bad)"
                  : "var(--cb-faint)";
          return (
            <button
              key={site.id}
              className="cb-site-card"
              disabled={!running || busy.size > 0}
              aria-label={`${t("sites.test")} ${site.name}`}
              onClick={() => void test([site.id])}
            >
              <span className="text-xs font-medium">{site.name}</span>
              <span
                className="text-[10px]"
                style={{ color: "var(--cb-faint)" }}
              >
                {site.host}
              </span>
              <span
                className="flex items-center gap-1.5 text-[11px] mt-2"
                style={{ color }}
              >
                {pending ? (
                  <ProgressRing
                    value={null}
                    label={t("sites.testing")}
                    size={12}
                  />
                ) : (
                  <span
                    className="cb-site-dot"
                    style={{ backgroundColor: color }}
                  />
                )}
                {text}
                <span className="ml-auto tabular-nums">
                  {!pending &&
                  result?.latency_ms !== null &&
                  result?.latency_ms !== undefined
                    ? `${result.latency_ms} ms`
                    : ""}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      <p className="text-[10px] mt-3" style={{ color: "var(--cb-faint)" }}>
        {running ? t("sites.scope") : t("sites.stopped")}
      </p>
    </section>
  );
}
