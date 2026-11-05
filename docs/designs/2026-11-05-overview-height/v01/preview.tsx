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
   const plot=document.querySelector<HTMLElement>('.cb-chart-drawing');
   if(main&&plot)setMetrics(`${innerWidth}×${innerHeight} · 段间距 ${getComputedStyle(main).rowGap} · 绘图区 ${Math.round(plot.getBoundingClientRect().height)}px`);
  });
  const frame=requestAnimationFrame(()=>{observer.observe(document.documentElement);document.querySelectorAll('.cb-home-main,.cb-chart-drawing').forEach(el=>observer.observe(el));});
  return()=>{cancelAnimationFrame(frame);observer.disconnect()};
 },[]);
 return <><NotificationProvider><App/></NotificationProvider><span style={{position:'fixed',bottom:4,left:'32%',fontSize:9,color:'var(--cb-text-dim)',pointerEvents:'none',zIndex:100}}>模拟数据 · {metrics}</span></>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
