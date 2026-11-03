// Development-only fixture. Never calls an installed app or changes network settings.
const params=new URLSearchParams(location.search), scenario=params.get('case')??'ready';
const listeners=new Map<string,Set<(e:{payload:unknown})=>void>>();
export let portWrites=0;
let port=7898;
const profiles=[{id:'demo',name:'示例配置 · Demo',kind:'remote',update_interval_min:360,last_updated:Date.now()/1000-3600,override_ids:[]}];
const nodes=[{name:'Tokyo · Hy2',kind:'Hysteria2',alive:true,delay_ms:84},{name:'Hong Kong · VLESS',kind:'Vless',alive:false,delay_ms:0}];
const snapshot={rows:[{id:'a',host:'a-very-long-target.example.com:443',rule:'MATCH',chains:'Tokyo · Hy2',up:1024,down:4096,network:'TCP',kind:'http',process:'Browser',process_path:'/Applications/Example Browser.app/Contents/MacOS/Example Browser',elapsed_ms:null},{id:'b',host:'example.org:443',rule:'DIRECT',chains:'DIRECT',up:0,down:0,network:'TCP',kind:'http',process:'Browser',elapsed_ms:90000000}],memory:null,upload_total:12582912,download_total:33554432};
function emit(name:string,payload:unknown){listeners.get(name)?.forEach(cb=>cb({payload}))}
setInterval(()=>{emit('connections://data',JSON.stringify(snapshot));emit('traffic://data',JSON.stringify({up:1024,down:4096}));},1000);
export async function listen(name:string, cb:(e:{payload:unknown})=>void){if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name)!.add(cb);return()=>{listeners.get(name)?.delete(cb)}}
const history=[{id:'profile-failure',kind:'warning',code:'profile.updateFailed',title:'',titleKey:'',description:'',details:'Simulated subscription timeout',source:'profile-auto-update-demo',operationId:'profile-auto-update-demo',dedupeKey:'',duration:0,actions:['profiles'],progress:null,createdAt:Date.now(),updatedAt:Date.now(),readAt:null,resolvedAt:null,count:1,dismissed:true},{id:'port-failure',kind:'error',code:'',title:'Port failed',titleKey:'settings.port',description:'',details:'Address in use',source:'setting-port',operationId:'setting-port',dedupeKey:'',duration:0,actions:['settings'],progress:null,createdAt:Date.now(),updatedAt:Date.now(),readAt:null,resolvedAt:null,count:1,dismissed:true}];
let revision=1,navigateTo:string|null=null;
const notificationSnapshot=()=>({revision,active:[],history,navigateTo});
const sendNotices=()=>{revision++;emit('app://notifications',notificationSnapshot())};
const pause=(ms:number)=>new Promise(r=>setTimeout(r,ms));
export async function invoke(command:string,args:Record<string,any>={}) {
 if(scenario==='loading'&&command==='list_profiles') return new Promise(()=>{});
 if(scenario==='error'&&['core_status','get_engine_config','proxies_snapshot'].includes(command))throw new Error('Simulated read failure');
 switch(command){
 case 'notification_snapshot':return notificationSnapshot();
 case 'notification_action':navigateTo=JSON.stringify(args.action==='profiles'?{page:'profiles',profileId:'demo',control:'cb-profile-detail'}:{page:'settings',settingSection:'network',control:'mixed-port'});sendNotices();return;
 case 'notification_ack_navigation':navigateTo=null;sendNotices();return;
 case 'notification_publish':return 'demo-notice';
 case 'profile_statuses':return [{id:'demo',last_success:Date.now()/1000-3600,next_update:Date.now()/1000+900,retry:true,failure:'Subscription server timed out (simulated)',using_previous:true,changes:null}];
 case 'list_overrides':return [];
 case 'config_snapshots':return [{id:'sample-one',at:Date.now()/1000-86400,profiles:3,overrides:2,active:'Example configuration'},{id:'sample-two',at:Date.now()/1000-172800,profiles:2,overrides:1,active:'Previous configuration'}];
 case 'restore_config_snapshot':await pause(700);return;
 case 'redact_log_lines':return args.lines.map((s:string)=>s.replace(/token=[^\s&]+/g,'token=[redacted]')).join('\n');
 case 'export_log_lines':await pause(300);return false;
 case 'run_diagnosis':{
  const ids=['core_running','controller','config_renders','listener','sysproxy','proxied_traffic','dns_direct'],rows=[];
  for(const id of ids){emit('diagnosis://progress',{run_id:args.runId,id,result:null});await pause(450);const row={id,ok:id!=='proxied_traffic',skipped:id==='sysproxy',detail:id==='proxied_traffic'?'Proxy probe timed out (simulated)':'Checked (simulated)',fix:null};rows.push(row);emit('diagnosis://progress',{run_id:args.runId,id,result:row});}
  return rows;
 }

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
 case 'subscribe_logs':return {entries:Array.from({length:40},(_,i)=>({sequence:i+1,type:i%7===0?'warning':'info',payload:`[TCP] 127.0.0.1:1000(Example Browser) --> example.com:443 match Match using Japan · Tokyo ${i}`})),sequence:40,connected:true,generation:0};
 case 'clear_logs':return {entries:[],sequence:40,connected:true,generation:0};
 case 'logs_settings':return {save_enabled:true,retention_days:7};
 case 'update_settings_get':return {auto_check:true,auto_download:false};
 case 'update_state_get':return null;
 case 'autostart_status':return false;
 case 'test_site':await pause(700);return {id:args.id,status:args.id==='youtube'?'restricted':'ok',http_status:args.id==='youtube'?403:200,latency_ms:123,error:null};
 case 'app_version':return '0.12.4-preview';
 }
 return null;
}
export const getVersion=async()=> '0.12.4-preview';
export const getCurrentWindow=()=>({label:'main',startDragging:async()=>{},isFocused:async()=>true});
export class Resource {} export class Channel {}
export const getCurrentWebview=()=>({onDragDropEvent:async()=>()=>{}});
