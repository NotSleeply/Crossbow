import React from 'react';
import {createRoot} from 'react-dom/client';
import App from '../../../../apps/desktop/src/App';
import {NotificationProvider} from '../../../../apps/desktop/src/notifications/NotificationProvider';
import '../../../../apps/desktop/src/index.css';
import '../../../../apps/desktop/src/Layout.css';
import {portWrites} from './mock-tauri';
function Preview() {
 const [writes,setWrites]=React.useState(0);
 React.useEffect(()=>{const timer=setInterval(()=>setWrites(portWrites),200);return()=>clearInterval(timer)},[]);
 return <><NotificationProvider><App/></NotificationProvider><div style={{position:'fixed',bottom:4,left:'40%',zIndex:100,fontSize:10,color:'var(--cb-text-dim)'}}>验收模拟数据 · 端口应用次数 <b>{writes}</b> · {['ready','loading','error','stopped','noConfig'].map(c=><a style={{marginLeft:8}} key={c} href={`?case=${c}${location.search.includes('en')?'&en=1':''}`}>{c}</a>)}</div></>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
