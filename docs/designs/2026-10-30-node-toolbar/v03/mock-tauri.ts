const nodes = [
  ["自动选择", "URLTest", 161], ["🇯🇵 软银-JP-Hy2", "Hysteria2", 161],
  ["🇭🇰 HKT-Hy2", "Hysteria2", 211], ["🇸🇬 HDZ-SG-Hy2", "Hysteria2", 2208],
  ["🇯🇵 软银-JP-VLESS", "Vless", null], ["🇭🇰 HKT-VLESS", "Vless", null],
  ["🇸🇬 HDZ-SG-VLESS", "Vless", null], ["🇸🇬 HDZ-SG-Trojan", "Trojan", null],
].map(([name,kind,delay_ms])=>({name,kind,delay_ms,alive:typeof delay_ms === "number" && delay_ms > 0}));
const groups = ["节点选择", "自动选择", "AI 服务", "国际媒体", "电报代理", "GLOBAL"].map((name)=>({name,kind:name === "自动选择" ? "URLTest" : "Selector",now:"🇭🇰 HKT-Hy2",nodes}));
export async function invoke(command:string,args:Record<string,any>={}) {
  if(command === "proxies_snapshot") return groups;
  if(command === "core_status") return {state:"Running"};
  if(command === "get_ui_settings") return {lang:"zh",theme:"light"};
  if(command === "select_proxy") { const g = groups.find(g=>g.name===args.group); if(g) g.now=args.proxy; return; }
  if(command === "test_node_delay") return 123;
  if(command === "test_site") return {id:args.id,status:"ok",http_status:200,latency_ms:120,error:null};
  return;
}
export async function listen(){return ()=>{};}
export async function getVersion(){return "0.11.5-preview";}

// Updater module is imported by Home; no update operation is exposed by this harness.
export class Resource {}
export class Channel {}
