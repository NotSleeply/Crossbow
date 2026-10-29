const query = new URLSearchParams(location.search);
export const events = new Map<
  string,
  Set<(event: { payload: unknown }) => void>
>();
const empty = query.has("empty");
const stopped = empty || query.has("stopped");
let proxy = !stopped;
let tun = !stopped;
let mode = "rule";
const profile = {
  id: "preview",
  name: query.has("stress")
    ? "我的订阅 · 日本与香港多协议节点配置（长名称验证）"
    : "my-nodes",
  kind: "local",
  update_interval_min: 60,
  override_ids: [],
};
const history = Array.from({ length: 120 }, (_, i) => ({
  down: stopped
    ? 0
    : Math.max(0, Math.sin(i / 6) * 14 + Math.sin(i * 1.8) * 3 + 16) * 1024,
  up: stopped ? 0 : Math.max(0, Math.sin(i / 5) * 2 + 4) * 1024,
}));
export const emit = (name: string, payload: unknown) =>
  events.get(name)?.forEach((cb) => cb({ payload }));
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
export const getVersion = async () => "0.11.2-preview";
export async function invoke(
  command: string,
  args?: Record<string, unknown>,
): Promise<unknown> {
  switch (command) {
    case "list_profiles":
      return empty ? [] : [profile];
    case "active_profile_id":
      return empty ? null : profile.id;
    case "core_status":
      return { state: stopped ? "Stopped" : "Running" };
    case "sysproxy_status":
      return { enabled: proxy, port: 7898 };
    case "tun_status":
      return { enabled: tun, ready: tun, coreRunning: !stopped };
    case "core_mode":
      return mode;
    case "current_outbound":
      return stopped
        ? null
        : {
            node: query.has("stress")
              ? "日本 · 东京 · 高速节点（长节点名称验证）Hy2"
              : "日本 · 东京 Hy2",
            chain: ["自动选择"],
            delay_ms: 84,
          };
    case "traffic_history":
      return history;
    case "coexist_detect":
      return [];
    case "update_state_get":
      return query.has("banner")
        ? { version: "0.11.3", notes: null, downloaded: true, progress: null }
        : null;
    case "get_ui_settings":
      return { theme: "light", lang: query.has("en") ? "en" : "zh" };
    case "get_engine_config":
      return { engine: "mihomo", mixed_port: 7898, core_installed: true };
    case "sysproxy_toggle":
      proxy = !proxy;
      emit("sysproxy://status", { enabled: proxy, port: 7898 });
      return;
    case "set_tun":
      tun = Boolean(args?.enable);
      emit("tun://status", tun);
      return;
    case "set_core_mode":
      mode = String(args?.mode);
      emit("core://mode", mode);
      return;
    case "subscribe_traffic":
      queueMicrotask(() =>
        emit("traffic://data", {
          down: stopped
            ? 0
            : query.has("stress")
              ? 999.9 * 1024 * 1024
              : 22.4 * 1024,
          up: stopped
            ? 0
            : query.has("stress")
              ? 999.9 * 1024 * 1024
              : 5.9 * 1024,
        }),
      );
      return;
    case "subscribe_connections":
      queueMicrotask(() =>
        emit("connections://data", {
          rows: Array(query.has("stress") ? 99999 : stopped ? 0 : 49).fill({}),
        }),
      );
      return;
    case "unsubscribe_traffic":
    case "unsubscribe_connections":
    case "notification_publish":
    case "notification_dismiss":
      return;
    default:
      throw new Error(`Unsupported preview command: ${command}`);
  }
}
// Optional updater module is discovered by Vite; no native resources are opened.
export class Resource {
  constructor(public rid: number) {}
}
export class Channel {
  onmessage?: (message: unknown) => void;
}
