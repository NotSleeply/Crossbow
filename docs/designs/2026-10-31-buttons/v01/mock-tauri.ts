// This module is the only Tauri boundary used by the preview. All changes are in memory.
import {
  invoke as notices,
  listen as listenNotices,
} from "../../2026-10-29-notifications/v02/mock-tauri";
const params = new URLSearchParams(location.search);
let theme = params.has("dark") ? "dark" : "light";
let profiles = [
  {
    id: "local",
    name: "my-nodes · 日本与香港多协议节点配置",
    kind: "local",
    update_interval_min: 0,
    override_ids: [],
    last_updated: 1793390400,
  },
  {
    id: "demo",
    name: "示例订阅",
    kind: "remote",
    update_interval_min: 360,
    override_ids: [],
    last_updated: 1793390400,
    traffic: { upload: 1024, download: 10240, total: 1048576, expire: 0 },
  },
];
const nodes = [
  ["自动选择", "URLTest", 84],
  ["🇯🇵 软银-JP-Hy2", "Hysteria2", 84],
  ["🇭🇰 HKT-Hy2", "Hysteria2", 211],
  ["🇸🇬 SG-Hy2", "Hysteria2", 300],
  ["🇯🇵 软银-JP-VLESS", "Vless", null],
  ["🇭🇰 HKT-VLESS", "Vless", null],
].map(([name, kind, delay_ms]) => ({
  name,
  kind,
  delay_ms,
  alive: typeof delay_ms === "number",
}));
const groups = ["节点选择", "自动选择", "国际媒体"].map((name) => ({
  name,
  kind: name === "自动选择" ? "URLTest" : "Selector",
  now: "🇯🇵 软银-JP-Hy2",
  nodes,
}));
const events = new Map<string, Set<(e: { payload: any }) => void>>();
function emit(name: string, payload: any) {
  events.get(name)?.forEach((f) => f({ payload }));
}
export async function listen(name: string, cb: (e: { payload: any }) => void) {
  if (name === "app://notifications") return listenNotices(name, cb);
  if (!events.has(name)) events.set(name, new Set());
  events.get(name)!.add(cb);
  return () => {
    events.get(name)?.delete(cb);
  };
}
export async function invoke(command: string, args: Record<string, any> = {}) {
  if (command.startsWith("notification_")) return notices(command, args);
  switch (command) {
    case "platform_capabilities":
      return { system_proxy: true, tun: true, app_update: true };
    case "list_profiles":
      return profiles.map((p) => ({ ...p }));
    case "active_profile_id":
      return "local";
    case "get_ui_settings":
      return { lang: "zh", theme, lightweight_close: false };
    case "get_engine_config":
      return {
        engine: "mihomo",
        mixed_port: 7898,
        allow_lan: false,
        flag_emoji: true,
      };
    case "core_status":
      return { state: "Running" };
    case "core_binary_info_for":
      return { source: "bundled", version: "Mihomo Meta v1.19.32" };
    case "sysproxy_status":
      return { enabled: true, port: 7898 };
    case "tun_status":
      return { enabled: false, ready: true, coreRunning: true };
    case "core_mode":
      return "rule";
    case "current_outbound":
      return {
        node: "🇯🇵 软银-JP-Hy2",
        chain: ["节点选择", "自动选择"],
        delay_ms: 84,
      };
    case "coexist_detect":
      return [];
    case "traffic_history":
      return Array.from({ length: 120 }, (_, i) => ({
        up: 300 + Math.max(0, Math.sin(i / 10)) * 500,
        down: 10000 + Math.max(0, Math.sin(i / 9)) * 60000,
      }));
    case "proxies_snapshot":
      return groups;
    case "test_node_delay":
      await new Promise((r) => setTimeout(r, 800));
      return 96;
    case "select_proxy": {
      const g = groups.find((g) => g.name === args.group);
      if (g) g.now = args.name;
      return;
    }
    case "test_site":
      await new Promise((r) => setTimeout(r, 800));
      return {
        id: args.id,
        status: "ok",
        http_status: 200,
        latency_ms: 120,
        error: null,
      };
    case "logs_settings":
      return { save_enabled: true, retention_days: 7 };
    case "autostart_status":
      return false;
    case "update_settings_get":
      return { auto_check: false, auto_download: false };
    case "update_state_get":
      return null;
    case "list_overrides":
      return [];
    case "set_theme":
      theme = args.theme;
      emit("app://theme", theme);
      return;
    case "rename_profile":
      profiles = profiles.map((p) =>
        p.id === args.id ? { ...p, name: args.name } : p,
      );
      return;
    case "run_diagnosis":
      await new Promise((r) => setTimeout(r, 800));
      return [{ id: "core", label: "内核进程", ok: true, detail: "模拟结果" }];
    default:
      return;
  }
}
export const getVersion = async () => "0.11.5-preview";
export const getCurrentWindow = () => ({ startDragging: async () => {} });
export const getCurrentWebview = () => ({
  onDragDropEvent: async () => () => {},
});
export class Resource {}
export class Channel {}
