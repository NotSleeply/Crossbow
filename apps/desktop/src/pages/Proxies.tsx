import { notify } from "../notifications/service";
import { useCallback, useEffect, useRef, useState } from "react";
import { ipc, type GroupView } from "../ipc";
import { useT } from "../i18n";
import { PageHead } from "./Home";
import SiteConnectivity from "../components/SiteConnectivity";
import { Icon } from "../components/Icon";

/** 代理组页（v2）：组卡片 + 节点网格，点状态灯分色。 */
export default function ProxiesPage() {
  const t = useT();
  const [groups, setGroups] = useState<GroupView[]>([]);
  const [testing, setTesting] = useState<string | null>(null);
  const [testingNodes, setTestingNodes] = useState<Set<string>>(new Set());
  const batchInFlight = useRef(false);
  const singleInFlight = useRef(new Set<string>());
  const [selecting, setSelecting] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setGroups(await ipc.proxiesSnapshot());
    } catch (e) {
      setGroups([]);
      notify.error(e, "proxies-load");
    }
  }, []);

  useEffect(() => {
    load();
    const un = ipc.onCoreStatus((s) => {
      if (s.state === "Running") load();
    });
    return () => void un.then((f) => f());
  }, [load]);

  const testGroup = async (name: string) => {
    if (batchInFlight.current || singleInFlight.current.size > 0) return;
    const group = groups.find((g) => g.name === name);
    if (!group) return;

    batchInFlight.current = true;
    setTesting(name);
    const operationId = `latency-${crypto.randomUUID()}`;
    notify.publish({ kind: "progress", id: operationId, source: operationId, operationId, title: t("proxies.testing"), description: name });
    let finished = 0;
    setTestingNodes((current) => new Set([
      ...current,
      ...group.nodes.map((node) => nodeTestKey(name, node.name)),
    ]));

    let nextIndex = 0;
    const worker = async () => {
      while (nextIndex < group.nodes.length) {
        const node = group.nodes[nextIndex++];
        try {
          const delay = await ipc.testNodeDelay(node.name);
          setGroups((current) => current.map((g) =>
            g.name !== name ? g : {
              ...g,
              nodes: g.nodes.map((n) => n.name === node.name
                ? { ...n, delay_ms: delay, alive: delay > 0 }
                : n),
            },
          ));
        } catch {
          setGroups((current) => current.map((g) =>
            g.name !== name ? g : {
              ...g,
              nodes: g.nodes.map((n) => n.name === node.name
                ? { ...n, delay_ms: 0, alive: false }
                : n),
            },
          ));
        } finally {
          finished++;
          notify.publish({ kind: "progress", id: operationId, source: operationId, operationId, title: t("proxies.testing"), description: `${name} · ${finished}/${group.nodes.length}`, progress: finished / group.nodes.length * 100 });
          setTestingNodes((current) => {
            const next = new Set(current);
            next.delete(nodeTestKey(name, node.name));
            return next;
          });
        }
      }
    };

    try {
      await Promise.all(Array.from(
        { length: Math.min(10, group.nodes.length) },
        () => worker(),
      ));
    } finally {
      // 完成不发结果卡：原位更新即反馈，进度卡一并关闭
      await notify.dismiss(operationId);
      batchInFlight.current = false;
      setTesting(null);
    }
  };

  const testNode = async (group: string, node: string) => {
    const key = nodeTestKey(group, node);
    if (singleInFlight.current.has(key) || batchInFlight.current) return;
    singleInFlight.current.add(key);
    setTestingNodes((current) => new Set([...current, key]));
    try {
      const delay = await ipc.testNodeDelay(node);
      setGroups((current) => current.map((g) =>
        g.name !== group ? g : {
          ...g,
          nodes: g.nodes.map((n) => n.name === node
            ? { ...n, delay_ms: delay, alive: delay > 0 }
            : n),
        },
      ));
    } catch {
      setGroups((current) => current.map((g) =>
        g.name !== group ? g : {
          ...g,
          nodes: g.nodes.map((n) => n.name === node
            ? { ...n, delay_ms: 0, alive: false }
            : n),
        },
      ));
    } finally {
      singleInFlight.current.delete(key);
      setTestingNodes((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  };

  const select = async (group: string, node: string) => {
    setSelecting(`${group}:${node}`);
    try {
      await ipc.selectProxy(group, node);
      setGroups((gs) => gs.map((g) => (g.name === group ? { ...g, now: node } : g)));
      notify.success(node, `proxy-select-${group}`);
    } catch (e) {
      notify.error(e, `proxy-select-${group}`);
      load();
    } finally {
      setSelecting(null);
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-3.5">
      <PageHead title={t("proxies.title")}>
        <button className="cb-btn acc" onClick={load}>
          <span className="inline-flex items-center gap-1.5">
            <Icon name="refresh" size={12} stroke="currentColor" />
            {t("proxies.refresh")}
          </span>
        </button>
      </PageHead>


      <SiteConnectivity contextKey={groups.map((group) => `${group.name}:${group.now ?? ""}`).join(";")} />
      {groups.length === 0 ? (
        <div
          className="cb-card flex h-64 flex-col items-center justify-center gap-2 text-sm"
          style={{ color: "var(--cb-text-dim)" }}
        >
          <span>{t("proxies.noCore")}</span>
          <span className="text-xs">{t("proxies.noCoreHint")}</span>
        </div>
      ) : (
        groups.map((g) => (
          <GroupCard
            key={g.name}
            group={g}
            testing={testing === g.name}
            busy={testing !== null || testingNodes.size > 0}
            testingNodes={testingNodes}
            selecting={selecting}
            onTest={() => testGroup(g.name)}
            onTestNode={(n) => testNode(g.name, n)}
            onSelect={(n) => select(g.name, n)}
          />
        ))
      )}
    </div>
  );
}

function GroupCard({
  group,
  testing,
  busy,
  testingNodes,
  selecting,
  onTest,
  onTestNode,
  onSelect,
}: {
  group: GroupView;
  testing: boolean;
  busy: boolean;
  testingNodes: Set<string>;
  selecting: string | null;
  onTest: () => void;
  onTestNode: (node: string) => void;
  onSelect: (node: string) => void;
}) {
  const t = useT();
  return (
    <section className="cb-card px-[18px] py-4">
      <div className="mb-2.5 flex items-baseline gap-2.5">
        <b className="text-[13px] font-semibold">{group.name}</b>
        <span className="cb-micro">{group.kind}</span>
        <span className="cb-mono ml-auto text-[11px]" style={{ color: "var(--cb-accent)" }}>
          {t("proxies.now")} → {group.now ?? "—"}
        </span>
        <button
          className={`cb-btn flex items-center gap-1.5 ${testing ? "opacity-60" : ""}`}
          onClick={onTest}
          disabled={busy}
        >
          <svg
            className={`h-3 w-3 ${testing ? "animate-spin" : ""}`}
            viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          >
            <path d="M21 12a9 9 0 1 1-9-9" strokeLinecap="round" />
          </svg>
          {testing ? t("proxies.testing") : t("proxies.testAll")}
        </button>
      </div>
      <div className="grid grid-cols-6 gap-2">
        {group.nodes.map((n) => {
          const sel = group.now === n.name;
          const cls = delayClass(n.delay_ms);
          const nodeTesting = testingNodes.has(nodeTestKey(group.name, n.name));
          return (
            <div
              key={n.name}
              className={`relative rounded-[10px] px-3 py-2.5 text-left transition-colors ${
                selecting === `${group.name}:${n.name}` ? "opacity-60" : ""
              }`}
              style={{
                border: `1px solid ${sel ? "var(--cb-accent-line)" : "var(--cb-line)"}`,
                background: sel
                  ? "linear-gradient(180deg, var(--cb-accent-soft), color-mix(in srgb, var(--cb-accent) 3%, transparent))"
                  : "var(--cb-surface-2)",
              }}
              title={n.kind}
            >
              <button
                type="button"
                className="absolute inset-0 rounded-[10px] border-0 bg-transparent"
                aria-label={n.name}
                aria-pressed={sel}
                disabled={selecting === `${group.name}:${n.name}`}
                onClick={() => onSelect(n.name)}
              />
              <div className="pointer-events-none truncate text-[12px] font-medium" title={n.name}>
                {n.name}
              </div>
              <div className="mt-1.5 flex items-center gap-1.5">
                <button
                  className="relative z-10 flex items-center gap-1.5 cursor-pointer"
                  title={t("proxies.testNode")}
                  aria-label={`${t("proxies.testNode")} ${n.name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onTestNode(n.name);
                  }}
                  disabled={nodeTesting || busy}
                >
                  {nodeTesting ? (
                    <svg
                      className="h-3 w-3 flex-none animate-spin"
                      viewBox="0 0 24 24" fill="none" stroke="var(--cb-accent)" strokeWidth="2"
                      aria-label={t("proxies.testing")}
                    >
                      <path d="M21 12a9 9 0 1 1-9-9" strokeLinecap="round" />
                    </svg>
                  ) : <i
                    className="h-[5px] w-[5px] flex-none rounded-full"
                    style={{
                      background:
                        n.delay_ms == null
                          ? "var(--cb-faint)"
                          : cls === "g"
                            ? "var(--cb-ok)"
                            : cls === "y"
                              ? "var(--cb-warn)"
                              : "var(--cb-bad)",
                    }}
                  />}
                  <span
                    className="cb-mono text-[10.5px] hover:text-[var(--cb-accent)]"
                    style={{ color: nodeTesting ? "var(--cb-accent)" : "var(--cb-text-dim)" }}
                  >
                    {nodeTesting ? t("proxies.testing") : delayText(n.delay_ms)}
                  </span>
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function nodeTestKey(group: string, node: string): string {
  return `${group}\u0000${node}`;
}

function delayText(ms: number | null): string {
  if (ms == null) return "—";
  if (ms === 0) return "超时";
  return `${ms} ms`;
}

function delayClass(ms: number | null): "g" | "y" | "r" | "" {
  if (ms == null || ms === 0) return "";
  if (ms <= 200) return "g";
  if (ms <= 500) return "y";
  return "r";
}
