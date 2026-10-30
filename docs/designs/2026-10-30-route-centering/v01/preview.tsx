import React,{useEffect,useState} from "react";
import {createRoot} from "react-dom/client";
import {ConnectionFlow} from "../../../../apps/desktop/src/components/ConnectionFlow";
import {Icon} from "../../../../apps/desktop/src/components/Icon";
import "../../../../apps/desktop/src/index.css";
if(new URLSearchParams(location.search).has("dark")) document.documentElement.classList.add("dark");
function Demo(){const [time,setTime]=useState(Date.now());useEffect(()=>{const id=setInterval(()=>setTime(Date.now()),1000);return ()=>clearInterval(id)},[]);return <main style={{padding:32,maxWidth:1100,margin:"auto"}}><h1 style={{fontSize:22}}>连接路径</h1><p style={{color:"var(--cb-text-dim)",fontSize:13,marginBottom:48}}>整组居中 · 正式组件与正式样式 · 模拟流量</p><section style={{containerName:"home-layout",containerType:"size",height:"calc(100vh - 160px)"}}><ConnectionFlow enabled lastTrafficAt={time}>{[["device","这台电脑","macOS"],["sliders","规则分流","规则"],["globe","日本 · 东京 Hy2","84 ms"]].map(([icon,title,sub],i)=><React.Fragment key={icon}>{i>0&&<span className="cb-route-line" data-route-segment aria-hidden="true"/>}<div><span className="cb-route-mark"><Icon name={icon} size={32}/></span><b>{title}</b><small>{sub}</small></div></React.Fragment>)}</ConnectionFlow></section></main>};createRoot(document.getElementById("root")!).render(<Demo/>);
