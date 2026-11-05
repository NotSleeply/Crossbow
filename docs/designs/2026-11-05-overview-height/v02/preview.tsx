import React from 'react';
import {createRoot} from 'react-dom/client';
import App from '../../../../apps/desktop/src/App';
import {NotificationProvider} from '../../../../apps/desktop/src/notifications/NotificationProvider';
import '../../../../apps/desktop/src/index.css';
import '../../../../apps/desktop/src/Layout.css';
function Preview() {
 const [metrics,setMetrics]=React.useState('');
 React.useEffect(()=>{
  const observer=new ResizeObserver(()=>{
   const main=document.querySelector<HTMLElement>('.cb-home-main');
   const path=document.querySelector<HTMLElement>('.cb-home-path');
   const bottom=document.querySelector<HTMLElement>('.cb-home-actions');
   const lead=document.querySelector<HTMLElement>('.cb-home-lead');
   const chart=document.querySelector<HTMLElement>('.cb-chart-only');
   const plot=document.querySelector<HTMLElement>('.cb-chart-drawing');
   if(main&&plot&&path&&bottom&&lead&&chart){
    const gapA=path.getBoundingClientRect().top-lead.getBoundingClientRect().bottom;
    const gapB=bottom.getBoundingClientRect().top-path.getBoundingClientRect().bottom;
    setMetrics(`${innerWidth}×${innerHeight} · 间距 ${gapA.toFixed(1)} / ${gapB.toFixed(1)} · 图表 ${Math.round(chart.getBoundingClientRect().height)} · 绘图区 ${Math.round(plot.getBoundingClientRect().height)}px`);
   }
  });
  const frame=requestAnimationFrame(()=>{observer.observe(document.documentElement);document.querySelectorAll('.cb-home-main,.cb-home-lead,.cb-home-path,.cb-home-actions,.cb-chart-drawing').forEach(el=>observer.observe(el));});
  return()=>{cancelAnimationFrame(frame);observer.disconnect()};
 },[]);
 return <><NotificationProvider><App/></NotificationProvider><span style={{position:'fixed',bottom:4,left:'32%',fontSize:9,color:'var(--cb-text-dim)',pointerEvents:'none',zIndex:100}}>模拟数据 · {metrics}</span></>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
