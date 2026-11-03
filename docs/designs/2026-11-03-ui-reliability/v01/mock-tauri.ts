// Development-only fixture. Never calls an installed app or changes network settings.
const params=new URLSearchParams(location.search), scenario=params.get('case')??'ready';
const listeners=new Map<string,Set<(e:{payload:unknown})=>void>>();
export let portWrites=0;
let port=7898;
const profiles=[{id:'demo',name:'示例配置 · Demo',kind:'local',update_interval_min:0,override_ids:[]}];
const nodes=[{name:'Tokyo · Hy2',kind:'Hysteria2',alive:true,delay_ms:84},{name:'Hong Kong · VLESS',kind:'Vless',alive:false,delay_ms:0}];
const snapshot={rows:[{id:'a',host:'example.com:443',rule:'MATCH',chains:'Tokyo · Hy2',up:1024,down:4096,network:'TCP',kind:'http',process:'Browser',elapsed_ms:null},{id:'b',host:'example.org:443',rule:'DIRECT',chains:'DIRECT',up:0,down:0,network:'TCP',kind:'http',process:'Browser',elapsed_ms:90000000}],memory:null,upload_total:12582912,download_total:33554432};
function emit(name:string,payload:unknown){listeners.get(name)?.forEach(cb=>cb({payload}))}
setInterval(()=>{emit('connections://data',JSON.stringify(snapshot));emit('traffic://data',JSON.stringify({up:1024,down:4096}));},1000);
export async function listen(name:string, cb:(e:{payload:unknown})=>void){if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name)!.add(cb);return()=>{listeners.get(name)?.delete(cb)}}
export async function invoke(command:string,args:Record<string,any>={}) {
 if(scenario==='loading'&&command==='list_profiles') return new Promise(()=>{});
 if(scenario==='error'&&['core_status','get_engine_config','proxies_snapshot'].includes(command))throw new Error('Simulated read failure');
 switch(command){
 case 'notification_snapshot':return {revision:0,active:[],history:[],navigateTo:null};
 case 'get_ui_settings':return {lang:params.has('en')?'en':'zh',theme:params.has('dark')?'dark':'light',lightweight_close:false};
 case 'platform_capabilities':return {system_proxy:true,tun:true,app_update:true};
 case 'list_profiles':return scenario==='noConfig'?[]:profiles;
 case 'active_profile_id':return 'demo';
 case 'core_status':return {state:scenario==='stopped'?'Stopped':'Running'};
 case 'get_engine_config':return {engine:'mihomo',mixed_port:port,flag_emoji:true,allow_lan:false,core_installed:true};
 case 'set_mixed_port':portWrites++;port=args.port;return;
 case 'core_binary_info_for':return {source:'bundled',version:'mihomo v1.19.32'};
 case 'tun_status':return {enabled:false,ready:true,coreRunning:true};
 case 'sysproxy_status':return {enabled:true,port};
 case 'core_mode':return 'rule';
 case 'coexist_detect':return [];
 case 'current_outbound':return {node:'Tokyo · Hy2',chain:['节点选择','Tokyo · Hy2'],delay_ms:84};
 case 'traffic_history':return Array.from({length:120},(_,i)=>({up:200+Math.sin(i/4)*180,down:3000+Math.sin(i/8)*2000}));
 case 'proxies_snapshot':return [{name:'节点选择',kind:'Selector',now:nodes[0].name,nodes}];
 case 'subscribe_logs': case 'clear_logs':return {entries:[],sequence:0,connected:true,generation:0};
 case 'logs_settings':return {save_enabled:true,retention_days:7};
 case 'update_settings_get':return {auto_check:true,auto_download:false};
 case 'update_state_get':return null;
 case 'autostart_status':return false;
 case 'test_site':return {id:args.id,status:'ok',http_status:200,latency_ms:123,error:null};
 case 'app_version':return '0.12.4-preview';
 }
 return null;
}
export const getVersion=async()=> '0.12.4-preview';
export const getCurrentWindow=()=>({label:'main',startDragging:async()=>{},isFocused:async()=>true});
export class Resource {} export class Channel {}
