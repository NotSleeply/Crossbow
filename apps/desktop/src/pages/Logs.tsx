import { useEffect, useMemo, useRef, useState } from "react";
import { ipc, type LogEntry } from "../ipc";
import { useT } from "../i18n";

const MAX_LINES = 2000;
const RENDER_TAIL = 500;

const LEVELS = ["debug", "info", "warning", "error"] as const;
type Level = (typeof LEVELS)[number];

const LEVEL_COLOR: Record<string, string> = {
  debug: "var(--cb-faint)",
  info: "var(--cb-text)",
  warning: "var(--cb-warn)",
  error: "var(--cb-bad)",
};

/** mihomo 连接日志的结构化视图；解析失败的行（warning/error 等）走原始整行。 */
interface ParsedLog {
  network: string;
  process: string;
  source: string;
  target: string;
  rule: string;
  outbound: string;
}

function parseLog(payload: string): ParsedLog | null {
  const m = /^\[(TCP|UDP)\]\s+(.+?)\s+-->\s+(.+)$/.exec(payload);
  if (!m) return null;
  const [, network, left, right] = m;
  // 左段：ip:port(进程名) —— 进程名内可能含括号，取最后一个括号组
  const pm = /^(.*?)\((.*)\)$/.exec(left);
  const source = pm ? pm[1] : left;
  const process = pm ? pm[2] : "";
  // 右段：目标 match 规则 using 出口
  const rm = /^(.+?)\s+match\s+(.*?)\s+using\s+(.+)$/.exec(right);
  if (!rm) return null;
  return { network, process, source, target: rm[1], rule: rm[2], outbound: rm[3] };
}

/** 规则段拆成「类型 + 明细」：DomainSuffix(qq.com) → DomainSuffix / qq.com */
function splitRule(rule: string): { type: string; detail: string } {
  const m = /^([A-Za-z]+)\((.*)\)$/.exec(rule);
  return m ? { type: m[1], detail: m[2] } : { type: rule, detail: "" };
}

const isDirect = (outbound: string) => /^direct$/i.test(outbound.trim());

/** 日志页：结构化表格（表头 + 类型/进程/目标/规则/出口），级别过滤 + 关键字过滤。 */
export default function LogsPage() {
  const t = useT();
  const [lines, setLines] = useState<LogEntry[]>([]);
  const [enabled, setEnabled] = useState<Record<Level, boolean>>({
    debug: false,
    info: true,
    warning: true,
    error: true,
  });
  const [keyword, setKeyword] = useState("");
  const pinned = useRef(true);
  const boxRef = useRef<HTMLDivElement>(null);
  const subscriptionGeneration = useRef(0);

  useEffect(() => {
    const generation = ++subscriptionGeneration.current;
    let active = true;
    // Register the Tauri event handler before the backend can emit its first batch.
    const unlisten = ipc.onLogs((entries) => {
      setLines((prev) => {
        const next = [...prev, ...entries];
        return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next;
      });
    });

    // StrictMode runs setup → cleanup → setup in development. Waiting for the
    // listener avoids losing the first batch; the generation guard prevents a
    // stale setup from subscribing after the page has already been replaced.
    const subscribe = unlisten.then(() => {
      if (!active || subscriptionGeneration.current !== generation) return;
      return ipc.subscribeLogs().catch(console.error);
    });

    return () => {
      active = false;
      void unlisten.then((unlistenEvent) => unlistenEvent());
      // Delay unsubscription until any in-flight subscribe has settled. A
      // StrictMode remount advances the generation synchronously and keeps the
      // replacement subscription alive.
      void subscribe.catch(() => {}).finally(() => {
        queueMicrotask(() => {
          if (subscriptionGeneration.current === generation) {
            ipc.unsubscribeLogs().catch(() => {});
          }
        });
      });
    };
  }, []);

  // 自动滚动：用户上滚超过 40px 即暂停跟随
  useEffect(() => {
    if (pinned.current && boxRef.current) {
      boxRef.current.scrollTop = boxRef.current.scrollHeight;
    }
  }, [lines]);

  const shown = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return lines
      .filter((l) => enabled[(l.type as Level) ?? "info"] ?? true)
      .filter((l) => !kw || l.payload.toLowerCase().includes(kw))
      .slice(-RENDER_TAIL);
  }, [lines, enabled, keyword]);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-3" style={{ height: "100%" }}>
      <div className="flex items-center gap-3">
        <h1 className="text-[15px] font-semibold tracking-tight">{t("logs.title")}</h1>
        {LEVELS.map((lv) => (
          <label key={lv} className="flex items-center gap-1 text-xs"
            style={{ color: "var(--cb-text-dim)" }}>
            <input
              type="checkbox"
              checked={enabled[lv]}
              onChange={(e) => setEnabled({ ...enabled, [lv]: e.target.checked })}
            />
            {lv}
          </label>
        ))}
        <div className="flex-1" />
        <input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder={t("logs.keyword")}
          className="cb-input cb-selectable w-56"
        />
        <button onClick={() => setLines([])} className="cb-btn">
          {t("logs.clear")}
        </button>
      </div>

      <div
        ref={boxRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
        className="cb-card cb-selectable cb-mono text-[11px] leading-5"
        style={{ height: 520, overflowY: "auto" }}
      >
        {shown.length === 0 ? (
          <div className="flex h-full items-center justify-center"
            style={{ color: "var(--cb-text-dim)" }}>
            {t("logs.empty")}
          </div>
        ) : (
          <>
            <div className="cb-log-grid cb-log-head">
              <span>{t("logs.col.type")}</span>
              <span>{t("logs.col.process")}</span>
              <span>{t("logs.col.target")}</span>
              <span>{t("logs.col.rule")}</span>
              <span>{t("logs.col.outbound")}</span>
            </div>
            {shown.map((l, i) => {
              const parsed = parseLog(l.payload);
              if (!parsed) {
                return (
                  <div key={i} className="cb-log-raw"
                    style={{ color: LEVEL_COLOR[l.type] ?? "var(--cb-text-dim)" }}>
                    {l.payload}
                  </div>
                );
              }
              const rule = splitRule(parsed.rule);
              const direct = isDirect(parsed.outbound);
              return (
                <div key={i} className="cb-log-grid cb-log-row">
                  <span>
                    <span className="cb-log-tag"
                      style={
                        parsed.network === "UDP"
                          ? { color: "var(--cb-down)", background: "rgba(183, 166, 248, 0.13)" }
                          : { color: "var(--cb-accent)", background: "var(--cb-accent-soft)" }
                      }>
                      {parsed.network}
                    </span>
                  </span>
                  <span className="cb-log-process">
                    <span className="truncate">{parsed.process || "—"}</span>
                    <span className="cb-log-source">{parsed.source}</span>
                  </span>
                  <span className="truncate" style={{ color: "var(--cb-text)" }}>
                    {parsed.target}
                  </span>
                  <span className="truncate" style={{ color: "var(--cb-text-dim)" }}>
                    {rule.type}
                    {rule.detail && (
                      <span style={{ color: "var(--cb-faint)" }}> · {rule.detail}</span>
                    )}
                  </span>
                  <span>
                    <span className="cb-log-outbound"
                      style={
                        direct
                          ? { color: "var(--cb-ok)", background: "rgba(74, 222, 128, 0.1)" }
                          : { color: "var(--cb-accent)", background: "var(--cb-accent-soft)" }
                      }>
                      {parsed.outbound}
                    </span>
                  </span>
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
