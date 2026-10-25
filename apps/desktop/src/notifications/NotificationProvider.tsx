import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { currentLang, initLang, useT } from "../i18n";
import { ipc } from "../ipc";
import { notificationText as text, type Notification, type NotificationSnapshot } from "./service";
import "./notifications.css";

export const isNotificationWindow = new URLSearchParams(location.search).has("notifications");
const initial: NotificationSnapshot = { revision: -1, active: [], history: [], navigateTo: null };
const Context = createContext(initial);

export function NotificationProvider({ children }: { children?: ReactNode }) {
  const [snapshot, setSnapshot] = useState(initial);
  useEffect(() => {
    let disposed = false;
    let off: (() => void) | undefined;
    const receive = (next: NotificationSnapshot) => {
      if (disposed) return;
      setSnapshot((previous) => next.revision > previous.revision ? next : previous);
    };
    // Listen before requesting the snapshot to avoid dropping a background
    // result while the main webview is being recreated.
    void listen<NotificationSnapshot>("app://notifications", (event) => receive(event.payload))
      .then(async (unlisten) => {
        if (disposed) { unlisten(); return; }
        off = unlisten;
        receive(await invoke<NotificationSnapshot>("notification_snapshot"));
      }).catch((error) => console.error("notification initialization", error));
    return () => { disposed = true; off?.(); };
  }, []);
  return <Context.Provider value={snapshot}>{children}<NotificationViewport /></Context.Provider>;
}

function NotificationViewport() {
  const snapshot = useContext(Context);
  const stack = useRef<HTMLDivElement>(null);
  const [leaving, setLeaving] = useState<Notification[]>([]);
  const previous = useRef<Notification[]>([]);
  useT(); // Refresh the labels when the application's language changes.
  useEffect(() => {
    const removed = previous.current.filter((n) => !snapshot.active.some((a) => a.id === n.id));
    previous.current = snapshot.active;
    if (!removed.length) return;
    setLeaving((prev) => [...prev, ...removed]);
    // 原位淡出：退场卡片留在正常文档流中播放动画（不占绝对定位层，
    // 不会被 viewport 的 overflow 裁剪），动画结束后自然移除
    const timer = window.setTimeout(() => {
      setLeaving((prev) => prev.filter((l) => !removed.some((r) => r.id === l.id)));
    }, 180);
    return () => window.clearTimeout(timer);
  }, [snapshot.active]);
  useEffect(() => {
    if (!isNotificationWindow || !stack.current) return;
    const observer = new ResizeObserver(() => {
      void invoke("notification_resize", { height: stack.current!.scrollHeight + 32 }).catch(console.error);
    });
    observer.observe(stack.current);
    return () => observer.disconnect();
  }, []);
  if (!snapshot.active.length && !leaving.length) return null;
  return <div className={`cb-notification-viewport ${isNotificationWindow ? "standalone" : ""}`} ref={stack}
    aria-label={text("history")}>
    {[...snapshot.active, ...leaving].map((notice) => {
      const isLeaving = leaving.some((l) => l.id === notice.id);
      return <NotificationCard key={notice.id} notice={notice} inert={isLeaving} leaving={isLeaving} />;
    })}
  </div>;
}

function StatusIcon({ kind }: { kind: Notification["kind"] }) {
  return <svg viewBox="0 0 24 24" className={`cb-notification-icon ${kind === "progress" ? "spinning" : ""}`}
    fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {kind === "progress" ? <path d="M21 12a9 9 0 1 1-9-9" /> : <>
      <circle cx="12" cy="12" r="9" />
      {kind === "success" ? <path d="m8 12 3 3 5-6" /> : kind === "error" ? <path d="m9 9 6 6m0-6-6 6" /> : <path d="M12 8v5m0 3h.01" />}
    </>}
  </svg>;
}
function NotificationCard({ notice, history = false, inert = false, leaving = false }: { notice: Notification; history?: boolean; inert?: boolean; leaving?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const [copyState, setCopyState] = useState("");
  const hover = useRef(false);
  const focused = useRef(false);
  const pause = () => {
    if (!history && !inert) void invoke("notification_pause", { id: notice.id, paused: hover.current || focused.current || expanded }).catch(console.error);
  };
  useEffect(pause, [expanded, history]);
  useEffect(() => () => {
    if (!history) void invoke("notification_pause", { id: notice.id, paused: false }).catch(console.error);
  }, [notice.id, history]);
  const title = notice.title || text(notice.code || notice.kind);
  const description = notice.description ? (notice.code === "core.install" ? text(`stage.${notice.description}`) : notice.description) : (notice.kind === "error" ? text("failedHint") : notice.code === "core.safeMode" ? text("safeMode.hint") : notice.code === "tun.disabled" ? text("tun.disabled.hint") : "");
  const detailsId = `notice-details-${notice.id}`;
  return <article className={`cb-notification ${notice.kind} ${history ? "history" : ""} ${leaving ? "cb-notification-leaving" : ""}`} aria-hidden={inert || undefined}
    onMouseEnter={() => { hover.current = true; pause(); }} onMouseLeave={() => { hover.current = false; pause(); }}
    onFocus={() => { focused.current = true; pause(); }}
    onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) { focused.current = false; pause(); } }}>
    <StatusIcon kind={notice.kind} />
    <div className="cb-notification-body">
      <div role={history || inert ? undefined : notice.kind === "error" ? "alert" : "status"} aria-atomic="true">
        <div className="cb-notification-title">{title}{notice.count > 1 && <span className="cb-notification-count">×{notice.count}</span>}</div>
        {description && <p className="cb-selectable">{description}</p>}
      </div>
      {notice.kind === "progress" && notice.progress !== null && <progress max="100" value={notice.progress} aria-label={title} />}
      <div className="cb-notification-actions">
        {notice.details && <button aria-expanded={expanded} aria-controls={detailsId} onClick={() => setExpanded(!expanded)} tabIndex={inert ? -1 : undefined}>{text("details")}</button>}
        {notice.actions.map((action) => <button key={action} tabIndex={inert ? -1 : undefined} onClick={() => void invoke("notification_action", { action }).catch(console.error)}>{text(action)}</button>)}
      </div>
      {expanded && <div id={detailsId} className="cb-notification-details">
        <pre className="cb-selectable">{notice.details}</pre>
        <button onClick={async () => {
          try { await navigator.clipboard.writeText(notice.details); setCopyState(text("copied")); }
          catch { setCopyState(text("copyFailed")); }
        }}>{text("copy")}</button><span role="status">{copyState}</span>
      </div>}
    </div>
    {!history && <button className="cb-notification-close" aria-label={text("close")} tabIndex={inert ? -1 : undefined}
      onClick={() => void invoke("notification_dismiss", { id: notice.id }).catch(console.error)}>×</button>}
    {history && <time>{new Date(notice.createdAt).toLocaleTimeString(currentLang() === "en" ? "en-US" : "zh-CN", { hour: "2-digit", minute: "2-digit" })}</time>}
  </article>;
}

export function NotificationHistory() {
  const [open, setOpen] = useState(false);
  const { history } = useContext(Context);
  const ref = useRef<HTMLDivElement>(null);
  useT();
  useEffect(() => {
    if (!open) return;
    const click = (event: MouseEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(false); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", click); document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", click); document.removeEventListener("keydown", key); };
  }, [open]);
  return <div ref={ref} className="cb-notification-history">
    <button className="cb-btn" aria-expanded={open} onClick={() => setOpen(!open)}>{text("history")}</button>
    {open && <section className="cb-notification-history-panel" aria-label={text("history")}>
      <div className="cb-notification-history-head"><b>{text("history")}</b><button aria-label={text("close")} onClick={() => setOpen(false)}>×</button></div>
      {!history.length && <p>{text("empty")}</p>}
      {history.map((notice) => <NotificationCard key={notice.id} notice={notice} history />)}
    </section>}
  </div>;
}

export function NotificationWindow() {
  useEffect(() => {
    initLang();
    const apply = (theme: string) => document.documentElement.classList.toggle("dark", theme === "dark" || (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches));
    let alive = true;
    void ipc.getUiSettings().then((settings) => { if (alive) apply(settings.theme); });
    const off = ipc.onTheme(apply);
    const media = matchMedia("(prefers-color-scheme: dark)");
    const changed = () => void ipc.getUiSettings().then((settings) => apply(settings.theme));
    media.addEventListener("change", changed);
    return () => { alive = false; void off.then((f) => f()); media.removeEventListener("change", changed); };
  }, []);
  return <NotificationProvider />;
}

export function useNotificationNavigation(navigate: (page: string) => void) {
  const { navigateTo } = useContext(Context);
  useEffect(() => {
    if (!navigateTo) return;
    navigate(navigateTo);
    void invoke("notification_ack_navigation").catch(console.error);
  }, [navigateTo]);
}
