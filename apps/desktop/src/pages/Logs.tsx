import { notify } from "../notifications/service";
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

const MAX_PENDING = 400;

/** sing-box（clash_api）同连接多行的中间态（以行首连接 id 关联）。 */
interface SbPending {
  type: string;
  process: string;
  source: string;
  target: string;
  outbound: string;
  /** 首次出现时刻（ms），超时强制成行用 */
  seen: number;
}

/** sing-box 日志消费：把 inbound/router/outbound 同连接多行聚合为一条
 *  mihomo 风格合成行（复用现有结构化渲染）；非 sing-box 格式或无法
 *  识别的组件行返回 false 走原始兜底。 */
function consumeSingBox(
  payload: string,
  pending: Map<string, SbPending>,
  out: LogEntry[],
): boolean {
  const m = /^\[(\d+)\s+\d+ms\]\s+([^:]+):\s+(.*)$/.exec(payload);
  if (!m) return false;
  const [, id, comp, msg] = m;
  const tagOf = (c: string) => {
    const s = c.indexOf("[");
    return s >= 0 ? c.slice(s + 1, c.lastIndexOf("]")) : "";
  };
  const entry = (): SbPending => {
    let e = pending.get(id);
    if (!e) {
      e = { type: "", process: "", source: "", target: "", outbound: "", seen: Date.now() };
      pending.set(id, e);
    }
    return e;
  };
  if (comp.startsWith("inbound/")) {
    const tag = tagOf(comp); // tun-in / mixed-in
    const e = entry();
    e.type = tag === "tun-in" ? "TUN" : tag === "mixed-in" ? "MIXED" : tag.toUpperCase();
    const TO = "inbound connection to ";
    const FROM = "inbound connection from ";
    if (msg.startsWith(TO)) e.target = msg.slice(TO.length);
    if (msg.startsWith(FROM)) e.source = msg.slice(FROM.length);
    return true;
  }
  if (comp === "router" && msg.startsWith("found process path: ")) {
    const rest = msg.slice("found process path: ".length);
    const path = rest.split(", user:")[0]?.trim() ?? "";
    entry().process = path.split("/").pop() ?? path;
    return true;
  }
  if (comp.startsWith("outbound/") && msg.startsWith("outbound connection to ")) {
    const e = entry();
    e.outbound = tagOf(comp) || comp;
    e.target = msg.slice("outbound connection to ".length);
    const left = e.source ? `${e.source}(${e.process})` : `(${e.process})`;
    out.push({
      type: "info",
      payload: `[${e.type || "TCP"}] ${left} --> ${e.target} match Match using ${e.outbound}`,
    });
    pending.delete(id);
    return true;
  }
  return false;
}

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
  const [connected, setConnected] = useState(false);
  const pinned = useRef(true);
  const boxRef = useRef<HTMLDivElement>(null);
  const subscriptionGeneration = useRef(0);
  // sing-box 同连接多行聚合的中间态（跨批次保留，#57）
  const pendingRef = useRef(new Map<string, SbPending>());

  useEffect(() => {
    const generation = ++subscriptionGeneration.current;
    let active = true;
    // Register the Tauri event handler before the backend can emit its first batch.
    const unlisten = ipc.onLogs((entries) => {
      const out: LogEntry[] = [];
      for (const e of entries) {
        // sing-box（clash_api）日志：同连接多行聚合后再进表（#57）
        if (!consumeSingBox(e.payload, pendingRef.current, out)) out.push(e);
      }
      // 超时成行：挂起超过 3s 的连接（outbound 先到/日志乱序等场景）
      // 以已有部分信息强制成行，避免静默丢失；无目标也无出口的行
      // （孤立 router 行等）不含连接信息，直接丢弃
      const now = Date.now();
      for (const [id, e] of [...pendingRef.current]) {
        if (now - e.seen <= 3000) continue;
        pendingRef.current.delete(id);
        if (!e.target && !e.outbound) continue;
        const left = e.source ? `${e.source}(${e.process})` : `(${e.process})`;
        out.push({
          type: "info",
          payload: `[${e.type || "TCP"}] ${left} --> ${e.target || "?"} match Match using ${
            e.outbound || "?"
          }`,
        });
      }
      // 防御：未凑齐 outbound 的连接积压过多时丢弃最旧的中间态
      if (pendingRef.current.size > MAX_PENDING) {
        const drop = pendingRef.current.size - MAX_PENDING;
        for (const k of [...pendingRef.current.keys()].slice(0, drop)) {
          pendingRef.current.delete(k);
        }
      }
      setLines((prev) => {
        const next = [...prev, ...out];
        return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next;
      });
    });

    // StrictMode runs setup → cleanup → setup in development. Waiting for the
    // listener avoids losing the first batch; the generation guard prevents a
    // stale setup from subscribing after the page has already been replaced.
    const subscribe = unlisten.then(() => {
      if (!active || subscriptionGeneration.current !== generation) return;
      return ipc
        .subscribeLogs()
        .then(() => {
          if (active) setConnected(true);
        })
        .catch((error) => notify.error(error, "logs-stream"));
    });

    return () => {
      active = false;
      setConnected(false);
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
            {connected ? t("logs.empty") : t("logs.connecting")}
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
                    <span className="cb-log-source">{parsed.source || "—"}</span>
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
