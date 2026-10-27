import { invoke } from "@tauri-apps/api/core";
import { currentLang } from "../i18n";

export type NotificationKind = "success" | "info" | "warning" | "error" | "progress";
export type NotificationAction = "settings" | "diagnostics" | "logs" | "profiles" | "retryDownload";
export interface Notification {
  id: string;
  kind: NotificationKind;
  code: string;
  title: string;
  description: string;
  details: string;
  source: string;
  operationId: string;
  dedupeKey: string;
  duration: number | null;
  actions: NotificationAction[];
  progress: number | null;
  createdAt: number;
  count: number;
  dismissed: boolean;
}
export interface NotificationSnapshot {
  revision: number;
  active: Notification[];
  history: Notification[];
  navigateTo: string | null;
}
export type NotificationInput = Partial<Notification> & Pick<Notification, "kind">;

const copy = {
  success: ["操作成功", "Completed"], info: ["提示", "Information"],
  warning: ["需要注意", "Attention needed"], error: ["操作失败", "Operation failed"],
  progress: ["正在处理", "Working"], details: ["查看详情", "Details"],
  copy: ["复制详情", "Copy details"], copied: ["已复制", "Copied"],
  copyFailed: ["复制失败，可选中文本复制", "Copy failed. Select the text to copy it."],
  close: ["关闭通知", "Dismiss notification"], history: ["最近通知", "Recent notifications"],
  profiles: ["打开配置", "Open profiles"],
  retryDownload: ["重新下载", "Retry download"],
  empty: ["本次会话暂无通知", "No notifications in this session"],
  settings: ["前往设置", "Open settings"], diagnostics: ["打开诊断", "Open diagnostics"], logs: ["查看日志", "View logs"],
  failedHint: ["操作未完成，请查看详情后重试。", "The operation could not finish. Check the details before retrying."],
  "tray.proxy": ["系统代理切换", "Switch system proxy"], "tray.tun": ["TUN 模式切换", "Switch TUN mode"],
  "tray.profile": ["切换配置", "Switch profile"],
  "tray.node": ["节点切换", "Select node"], "tray.action": ["托盘操作", "Tray action"],
  "tray.latency": ["延迟测试", "Latency test"], "tray.latencyTimeout": ["延迟测试超时", "Latency test timed out"],
  "core.mode": ["切换代理模式", "Switch proxy mode"],
  "stage.downloading": ["正在下载内核…", "Downloading core…"],
  "stage.verifying": ["正在校验内核…", "Verifying core…"],
  "stage.done": ["下载完成", "Download complete"],
  "core.installReady": ["内核已下载", "Core downloaded"],
  "core.install": ["下载安装内核", "Install core"],
  "coexist.resolved": ["代理冲突提示已解除", "Proxy conflict cleared"],
  "profile.updateFailed": ["订阅自动更新失败", "Automatic subscription update failed"],
  "core.crashed": ["内核运行异常", "Core stopped unexpectedly"],
  "core.recovered": ["内核已恢复运行", "Core is running again"],
  "core.safeMode": ["已进入安全模式", "Safe mode enabled"],
  "tun.disabled": ["TUN 已自动关闭", "TUN turned off automatically"],
  "tun.disableFailed": ["TUN 自动恢复失败", "TUN recovery failed"],
  "import.done": ["订阅导入成功", "Subscription imported"], "import.failed": ["订阅导入失败", "Import failed"],
  "update.available": ["发现新版本", "An update is available"],
  "update.download": ["下载更新", "Download update"], "update.ready": ["更新已下载，可重启安装", "Update downloaded. Ready to install"],
  "update.connecting": ["正在连接下载…", "Connecting to download…"],
  "update.verifying": ["校验更新文件", "Verifying update"],
  "update.verifying.hint": ["下载完成，正在校验签名…", "Download complete. Verifying signature…"],
  "update.failed": ["更新下载失败", "Update download failed"],
  "safeMode.hint": ["覆写导致内核启动失败，已临时禁用全部覆写。请修复后重新应用。", "Overrides prevented startup and were disabled temporarily. Fix them before applying again."],
  "tun.disabled.hint": ["连续多次健康检测失败，已关闭 TUN。请检查网络或更换节点。", "Repeated health checks failed. TUN was turned off. Check the network or change nodes."],
} as const;
export function notificationText(code: string): string {
  const text = copy[code as keyof typeof copy];
  return text?.[currentLang() === "en" ? 1 : 0] ?? code;
}

// Serialize publication per operation, so a fast result cannot arrive before
// its progress card and overwrite it. Failed IPC must not create an error loop.
const pending = new Map<string, Promise<unknown>>();
function enqueue(key: string, action: () => Promise<unknown>): Promise<unknown> {
  const previous = pending.get(key) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(action).catch((error) => console.error("notification delivery failed", error));
  pending.set(key, next);
  void next.finally(() => { if (pending.get(key) === next) pending.delete(key); });
  return next;
}
function publish(input: NotificationInput): Promise<unknown> {
  const key = input.operationId || input.source || input.id || "notification";
  return enqueue(key, () => invoke("notification_publish", { notice: {
    id: "", code: "", title: "", description: "", details: "", source: "ui",
    operationId: "", dedupeKey: "", duration: null, actions: [], progress: null, ...input,
  } }));
}
export const notify = {
  publish,
  dismiss(operationId: string) {
    return enqueue(operationId, () => invoke("notification_dismiss", { id: operationId }));
  },
  start(source: string, title: string, description = "") {
    return publish({ kind: "progress", title, description, source, operationId: source });
  },
  success(description: string, source: string, title = "") {
    publish({ kind: "success", title, description, source, operationId: source });
  },
  info(description: string, source: string) {
    publish({ kind: "info", description, source, operationId: source });
  },
  error(error: unknown, source: string, title = "") {
    publish({ kind: "error", title, description: notificationText("failedHint"), details: String(error), source, operationId: source, actions: ["diagnostics"] });
  },
  async run<T>(source: string, title: string, task: () => Promise<T>, success?: string): Promise<{ ok: true; value: T } | { ok: false }> {
    await notify.start(source, title);
    try {
      const value = await task();
      notify.success(success ?? title, source);
      return { ok: true, value };
    } catch (error) {
      notify.error(error, source, title);
      return { ok: false };
    }
  },
};
