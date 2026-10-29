// UI-only fixture. Queue lifecycle is tested against Rust, not this mock.
import type { Notification } from "../../../../apps/desktop/src/notifications/service";
const events = new Map<string, Set<(event: { payload: unknown }) => void>>();
export async function listen(
  name: string,
  callback: (event: { payload: unknown }) => void,
) {
  if (!events.has(name)) events.set(name, new Set());
  events.get(name)!.add(callback);
  return () => {
    events.get(name)?.delete(callback);
  };
}
const make = (
  id: string,
  kind: Notification["kind"],
  code: string,
  extra: Partial<Notification> = {},
): Notification => ({
  id,
  kind,
  code,
  title: "",
  titleKey: "",
  description: "",
  details: "",
  source: id,
  operationId: id,
  dedupeKey: "",
  duration: null,
  actions: [],
  progress: null,
  createdAt: Date.now() - 60000,
  updatedAt: Date.now() - 60000,
  count: 1,
  dismissed: true,
  readAt: null,
  resolvedAt: null,
  ...extra,
});
let history: Notification[] = new URLSearchParams(location.search).has("empty")
  ? []
  : [
      make("tun", "warning", "tun.disabled", {
        actions: ["diagnostics"],
        details:
          "Health check failed 3 times. Current state: TUN disabled. No credentials stored.",
      }),
      make("subscription", "error", "profile.updateFailed", {
        description: "示例订阅 · 已保留上次可用配置",
        actions: ["profiles"],
        count: 3,
        details: "https://example.test/[redacted]\nHTTP 503 · Retry scheduled.",
      }),
      make("update", "success", "update.ready", {
        description: "v0.11.3",
        actions: ["settings"],
        readAt: Date.now(),
      }),
      make("import", "success", "import.done", {
        description: "示例配置 · 12 个节点",
        readAt: Date.now(),
      }),
    ];
let removed: Notification[] = [];
let revision = 0;
function snapshot() {
  return {
    revision,
    history: [...history],
    active: history.filter((n) => !n.dismissed).slice(0, 2),
    navigateTo: null,
  };
}
function emit() {
  revision++;
  events
    .get("app://notifications")
    ?.forEach((cb) => cb({ payload: snapshot() }));
}
export async function invoke(
  command: string,
  args: Record<string, any> = {},
): Promise<unknown> {
  switch (command) {
    case "notification_snapshot":
      return snapshot();
    case "notification_dismiss":
      history.forEach((n) => {
        if (n.id === args.id) n.dismissed = true;
      });
      break;
    case "notification_mark_read":
      history.forEach((n) => {
        if (!args.id || n.id === args.id) n.readAt = Date.now();
      });
      break;
    case "notification_clear_completed": {
      removed = history
        .filter(
          (n) =>
            !(n.kind === "error" || n.kind === "warning") || !!n.resolvedAt,
        )
        .filter((n) => n.kind !== "progress");
      history = history.filter((n) => !removed.includes(n));
      emit();
      return removed.length;
    }
    case "notification_restore_completed": {
      const count = removed.length;
      history.push(...removed);
      removed = [];
      emit();
      return count;
    }
    case "notification_resolve":
      history.forEach((n) => {
        if (n.source === args.source) {
          n.resolvedAt = Date.now();
          n.readAt = Date.now();
          n.dismissed = true;
        }
      });
      break;
    case "notification_publish": {
      const input = args.notice;
      const old = history.find(
        (n) =>
          n.operationId === input.operationId ||
          (n.dedupeKey && n.dedupeKey === input.dedupeKey),
      );
      const notice = make(
        old?.id || input.operationId,
        input.kind,
        input.code,
        { ...input, dismissed: false, updatedAt: Date.now() },
      );
      history = [notice, ...history.filter((n) => n !== old)];
      break;
    }
    case "notification_pause":
      return;
    case "notification_action":
      return;
    case "get_ui_settings":
      return { lang: "zh", theme: "light" };
    default:
      return;
  }
  emit();
}
export function repeat() {
  const n = history.find((n) => n.id === "subscription");
  if (n) {
    n.count++;
    n.updatedAt = Date.now();
    emit();
  }
}
export function recover() {
  const n = history.find((n) => n.id === "tun");
  if (n) {
    n.resolvedAt = Date.now();
    n.updatedAt = Date.now();
    n.readAt = null;
    emit();
  }
}
export function download() {
  const n = make("download", "progress", "update.download", {
    progress: 0,
    dismissed: false,
  });
  history.unshift(n);
  emit();
  const timer = setInterval(() => {
    n.progress = (n.progress || 0) + 25;
    if (n.progress >= 100) {
      clearInterval(timer);
      n.kind = "success";
      n.code = "update.ready";
      n.progress = null;
      n.description = "v0.11.4";
    }
    emit();
  }, 700);
}

export const getVersion = async () => "0.11.2-preview";
