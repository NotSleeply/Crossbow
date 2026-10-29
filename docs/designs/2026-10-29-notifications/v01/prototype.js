// Design-only session data: no IPC, network calls, or persisted preferences.
const initial = [
  {
    id: "tun",
    kind: "warning",
    title: "TUN 已自动关闭",
    description: "连续健康检查失败，已停止接管。请检查节点或网络。",
    time: "2 分钟前",
    pending: true,
    unread: true,
    count: 1,
    action: "打开诊断",
    details:
      "健康检查连续失败 3 次。\nTUN 已关闭；系统代理保持原有状态。\n此处为脱敏模拟数据。",
  },
  {
    id: "subscription",
    kind: "error",
    title: "订阅更新失败",
    description: "示例订阅暂时无法连接，已保留上次可用配置。",
    time: "8 分钟前",
    pending: true,
    unread: true,
    count: 3,
    action: "查看配置",
    details:
      "请求超时 · HTTP_REQUEST_TIMEOUT\n来源：https://example.com/[redacted]\n首次发生：18:02；最近发生：18:10。",
  },
  {
    id: "update",
    kind: "success",
    title: "更新已下载，可安装",
    description: "v0.11.3 已就绪，在方便时重启安装。",
    time: "18:01",
    pending: false,
    unread: false,
    count: 1,
    action: "前往安装",
    details: "版本：v0.11.3\n校验状态：已完成（模拟）",
  },
  {
    id: "import",
    kind: "success",
    title: "已导入配置",
    description: "我的节点 · 已设为当前配置",
    time: "17:48",
    pending: false,
    unread: false,
    count: 1,
    details: "来源：本地文件\n不包含真实节点、订阅或凭据。",
  },
];
let records = structuredClone(initial),
  filter = "all",
  centerOpen = true,
  expanded = new Set(),
  undoRecords = [],
  taskTimer,
  toastId = null,
  dismissed = new Set();
const center = document.querySelector(".notification-center"),
  list = document.querySelector(".notice-list"),
  bell = document.querySelector(".bell"),
  host = document.querySelector(".toast-host");
const safe = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const statusIcon = (kind, progress = null) =>
  `<svg class="notice-status ${kind === "progress" && progress === null ? "spinner" : ""}" viewBox="0 0 24 24" aria-hidden="true">${kind === "progress" ? (progress === null ? '<path d="M20 12a8 8 0 1 1-8-8"/>' : `<circle cx="12" cy="12" r="8" class="ring-track"/><circle cx="12" cy="12" r="8" pathLength="100" stroke-dasharray="${progress} 100" transform="rotate(-90 12 12)"/>`) : `<circle cx="12" cy="12" r="9"/>${kind === "success" ? '<path d="m8 12 3 3 5-6"/>' : kind === "error" ? '<path d="m9 9 6 6m0-6-6 6"/>' : '<path d="M12 7v6m0 3h.01"/>'}`}</svg>`;
function place() {
  const box = bell.getBoundingClientRect();
  center.style.top = box.bottom + 8 + "px";
  center.style.right = Math.max(12, innerWidth - box.right) + "px";
  center.style.maxHeight = Math.min(590, innerHeight - box.bottom - 20) + "px";
}
addEventListener("resize", place);
function render() {
  place();
  const pending = records.filter((r) => r.pending).length,
    unread = records.filter((r) => r.unread).length;
  document.querySelector("#center-subtitle").textContent = pending
    ? `${pending} 条需要处理 · ${unread} 条未读`
    : unread
      ? `${unread} 条未读`
      : "没有待处理的问题";
  document.querySelector("#attention-count").textContent = pending || "";
  bell.querySelector("i").hidden = !unread;
  bell.setAttribute(
    "aria-label",
    `最近通知${unread ? `，${unread}条未读` : ""}`,
  );
  bell.setAttribute("aria-expanded", String(centerOpen));
  center.hidden = !centerOpen;
  document.querySelectorAll("[data-filter]").forEach((b) => {
    b.setAttribute("aria-selected", String(filter === b.dataset.filter));
    b.tabIndex = filter === b.dataset.filter ? 0 : -1;
  });
  list.setAttribute(
    "aria-labelledby",
    filter === "all" ? "all-tab" : "attention-tab",
  );
  document.querySelector("#read-all").disabled = !unread;
  document.querySelector("#clear-completed").disabled =
    filter === "attention" ||
    !records.some((r) => !r.pending && r.kind !== "progress");
  const visible =
    filter === "attention"
      ? records.filter((r) => r.pending)
      : [
          ...records.filter((r) => r.pending),
          ...records.filter((r) => !r.pending),
        ];
  if (!visible.length) {
    list.innerHTML = `<div class="empty-state"><svg viewBox="0 0 24 24"><path d="M18 8a6 6 0 0 0-12 0c0 6-3 7-3 9h18c0-2-3-3-3-9M10 21h4"/></svg><h3>${filter === "attention" ? "暂时没有需要处理的问题" : "暂无通知"}</h3><p>${filter === "attention" ? "重要异常会留在这里，查看详情后继续处理。" : "外观、语言等即时变化不会打扰你。"}</p></div>`;
    return;
  }
  list.innerHTML = visible
    .map(
      (r) =>
        `<article class="notice-row" data-id="${r.id}" data-kind="${r.kind}">${statusIcon(r.kind, r.progress ?? null)}<div class="notice-content"><div class="notice-top"><h3>${safe(r.title)}${r.count > 1 ? `<span class="repeat-count">×${r.count}</span>` : ""}</h3><div class="notice-meta">${r.unread ? '<i class="unread-dot" aria-label="未读"></i>' : ""}<time>${safe(r.time)}</time></div></div><p>${safe(r.description)}</p><div class="notice-actions">${r.action ? `<button class="text-button" data-action="${r.id}">${safe(r.action)}</button>` : ""}${r.details ? `<button class="text-button" data-details="${r.id}" aria-expanded="${expanded.has(r.id)}" aria-controls="details-${r.id}">${expanded.has(r.id) ? "收起详情" : "详情"}</button>` : ""}</div>${expanded.has(r.id) ? `<div class="details-content" id="details-${r.id}"><pre>${safe(r.details)}</pre><button class="text-button" data-copy="${r.id}">复制详情</button><span class="copy-status" role="status"></span></div>` : ""}</div></article>`,
    )
    .join("");
}
function feedback(s) {
  document.querySelector("#feedback").textContent = s;
}
function showToast(r) {
  if (centerOpen || dismissed.has(r.id)) return;
  toastId = r.id;
  host.innerHTML = `<article class="toast">${statusIcon(r.kind)}<div><b>${safe(r.title)}</b><p>${safe(r.description)}</p><button class="text-button" id="toast-view">查看通知</button></div><button class="icon-button" id="toast-close" aria-label="关闭提示"><svg viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18"/></svg></button></article>`;
  document.querySelector("#toast-close").onclick = () => {
    dismissed.add(r.id);
    host.innerHTML = "";
    toastId = null;
  };
  document.querySelector("#toast-view").onclick = () => setOpen(true);
}
function setOpen(open) {
  centerOpen = open;
  if (open) {
    host.innerHTML = "";
    toastId = null;
  }
  render();
  if (open) document.querySelector(".close-center").focus();
  else bell.focus();
}
bell.onclick = () => setOpen(!centerOpen);
document.querySelector(".close-center").onclick = () => setOpen(false);
document.addEventListener("pointerdown", (e) => {
  if (
    centerOpen &&
    !center.contains(e.target) &&
    !bell.contains(e.target) &&
    !e.target.closest(".scenario-buttons")
  ) {
    centerOpen = false;
    render();
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && centerOpen) {
    e.preventDefault();
    setOpen(false);
  }
});
document.querySelectorAll("[data-filter]").forEach((b) => {
  b.onclick = () => {
    filter = b.dataset.filter;
    render();
    document.querySelector(`[data-filter=${filter}]`).focus();
  };
  b.onkeydown = (e) => {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      filter = filter === "all" ? "attention" : "all";
      render();
      document.querySelector(`[data-filter=${filter}]`).focus();
    }
  };
});
document.querySelector("#read-all").onclick = () => {
  records.forEach((r) => (r.unread = false));
  render();
  feedback("已标记为已读；需要处理的问题仍然保留。");
};
list.onclick = async (e) => {
  const d = e.target.closest("[data-details]"),
    a = e.target.closest("[data-action]"),
    c = e.target.closest("[data-copy]");
  if (d) {
    expanded.has(d.dataset.details)
      ? expanded.delete(d.dataset.details)
      : expanded.add(d.dataset.details);
    records.find((r) => r.id === d.dataset.details).unread = false;
    render();
    document.querySelector(`[data-details="${d.dataset.details}"]`).focus();
  }
  if (a) {
    feedback(
      `演示入口：${a.textContent}。正式版本会跳转到对应页面，不自动更改网络或安装更新。`,
    );
    records.find((r) => r.id === a.dataset.action).unread = false;
    render();
  }
  if (c) {
    const r = records.find((r) => r.id === c.dataset.copy);
    try {
      await navigator.clipboard.writeText(r.details);
      c.nextElementSibling.textContent = "已复制";
    } catch {
      c.nextElementSibling.textContent = "可直接选中文本复制";
    }
  }
};
document.querySelector("#clear-completed").onclick = () => {
  undoRecords = records.filter((r) => !r.pending && r.kind !== "progress");
  records = records.filter((r) => r.pending || r.kind === "progress");
  const strip = document.querySelector("#undo-strip");
  strip.hidden = false;
  strip.querySelector("span").textContent =
    `已清除 ${undoRecords.length} 条完成记录`;
  render();
  feedback("只清理已完成记录，待处理异常与运行中的任务不会被清除。");
};
document.querySelector("#undo-strip button").onclick = () => {
  records = [
    ...records,
    ...undoRecords.filter(
      (r) => !records.some((existing) => existing.id === r.id),
    ),
  ];
  undoRecords = [];
  document.querySelector("#undo-strip").hidden = true;
  render();
};
document.querySelectorAll("[data-theme]").forEach(
  (b) =>
    (b.onclick = () => {
      document.documentElement.classList.toggle(
        "dark",
        b.dataset.theme === "dark",
      );
      document
        .querySelectorAll("[data-theme]")
        .forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      feedback("主题已直接应用，没有生成浮层或历史记录。");
    }),
);
document.querySelector("#language").onchange = () =>
  feedback("语言选择已更新，没有生成浮层或历史记录。（此稿文案仍以中文展示）");
document.querySelector("#repeat").onclick = () => {
  let r = records.find((r) => r.id === "subscription");
  if (r) {
    r.count++;
    r.time = "刚刚";
  } else {
    r = structuredClone(initial[1]);
    r.count = 1;
    r.time = "刚刚";
    records.unshift(r);
  }
  render();
  showToast(r);
  feedback(
    `同一订阅故障合并为一条记录，当前重复 ${r.count} 次。关闭浮层后，再次重复不会重新打扰。`,
  );
};
document.querySelector("#recover").onclick = () => {
  let r = records.find((r) => r.id === "tun");
  if (!r) {
    r = structuredClone(initial[0]);
    records.unshift(r);
  }
  Object.assign(r, {
    kind: "success",
    title: "TUN 连接已恢复",
    description: "连接已重新建立，无需继续处理。",
    pending: false,
    unread: true,
    time: "刚刚",
    action: "打开诊断",
    details: "此前：连续健康检查失败。\n现在：连接检查通过。（模拟）",
  });
  render();
  feedback("原问题已更新为恢复状态；不会同时保留一条“待处理故障”。");
  showToast(r);
};
document.querySelector("#download").onclick = () => {
  clearInterval(taskTimer);
  dismissed.delete("task");
  let r = records.find((r) => r.id === "task");
  if (!r) {
    r = { id: "task", count: 1 };
    records.unshift(r);
  }
  Object.assign(r, {
    kind: "progress",
    title: "正在下载更新",
    description: "v0.11.4 · 0%",
    progress: 0,
    pending: false,
    unread: false,
    time: "刚刚",
    action: null,
    details: "",
  });
  render();
  feedback("模拟下载开始；进度与结果始终更新同一条记录。");
  taskTimer = setInterval(() => {
    r.progress = Math.min(100, r.progress + 20);
    r.description = `v0.11.4 · ${r.progress}%`;
    if (r.progress === 20) showToast(r);
    if (toastId === r.id) {
      host.querySelector("p").textContent = r.description;
    }
    if (r.progress === 100) {
      clearInterval(taskTimer);
      Object.assign(r, {
        kind: "success",
        title: "更新已下载，可安装",
        description: "v0.11.4 已就绪，在方便时重启安装。",
        unread: true,
        action: "前往安装",
      });
      showToast(r);
    }
    render();
  }, 900);
};
document.querySelector("#empty").onclick = () => {
  clearInterval(taskTimer);
  records = [];
  expanded.clear();
  filter = "all";
  host.innerHTML = "";
  document.querySelector("#undo-strip").hidden = true;
  centerOpen = true;
  render();
  feedback("空状态样例；切换外观和语言仍然不会产生记录。");
};
document.querySelector("#reset").onclick = () => {
  clearInterval(taskTimer);
  records = structuredClone(initial);
  filter = "all";
  expanded.clear();
  dismissed.clear();
  host.innerHTML = "";
  document.querySelector("#undo-strip").hidden = true;
  centerOpen = true;
  render();
  feedback("已恢复脱敏样例。");
};
render();
