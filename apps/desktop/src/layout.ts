export type NodeDensity = "cards" | "list";
export function readDensity(): NodeDensity {
  try {
    return localStorage.getItem("cb-node-density") === "list"
      ? "list"
      : "cards";
  } catch {
    return "cards";
  }
}
/** Match FitItems' minimum widths and gaps, without stretching a sparse list. */
export function nodeResultHeight(
  length: number,
  width: number,
  density: NodeDensity,
): number {
  const columns =
    density === "cards"
      ? Math.max(1, Math.min(4, Math.floor((width + 10) / 210)))
      : 1;
  const row = density === "cards" ? 76 : 44,
    limit = density === "cards" ? 4 : 8;
  const rows = Math.max(1, Math.ceil(length / columns));
  return Math.min(rows, limit) * (row + 8) - 8 + (rows > limit ? 40 : 0);
}
export function friendlyKind(kind: string, t: (key: string) => string): string {
  const group: Record<string, string> = {
    Selector: "layout.manual",
    URLTest: "layout.auto",
    Fallback: "layout.fallback",
    LoadBalance: "layout.balance",
    Direct: "layout.direct",
    Reject: "layout.reject",
  };
  if (group[kind]) return t(group[kind]);
  const protocol: Record<string, string> = {
    vless: "VLESS",
    vmess: "VMess",
    hysteria2: "Hysteria 2",
    hysteria: "Hysteria",
    shadowsocks: "Shadowsocks",
    trojan: "Trojan",
    tuic: "TUIC",
    http: "HTTP",
    socks5: "SOCKS5",
  };
  return protocol[kind.toLowerCase()] ?? kind;
}
