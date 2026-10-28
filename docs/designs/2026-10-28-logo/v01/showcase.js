(async()=>{
  const variants=await fetch('variants.json').then(r=>r.json());
  const options=document.getElementById('options');
  function svg(v){return `<svg viewBox="0 0 100 100" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">${v.geometry}</svg>`;}
  function select(v){
    document.querySelectorAll('.logo-option').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.id===v.id)));
    document.getElementById('detail-family').textContent=v.id.toUpperCase()+' / '+v.family+' / '+v.name;
    document.getElementById('detail-title').textContent=v.title;
    document.getElementById('detail-rationale').textContent=v.rationale;
    document.getElementById('detail-tradeoff').textContent='取舍：'+v.tradeoff;
    document.querySelectorAll('.selected-mark').forEach(el=>el.innerHTML=svg(v));
    document.getElementById('download-svg').href='assets/'+v.id+'.svg';
    document.getElementById('download-mono').href='assets/'+v.id+'-mono.svg';
    document.getElementById('download-app').href='assets/'+v.id+'-app.svg';
    history.replaceState(null,'','#'+v.id);
  }
  for(const v of variants){let b=document.createElement('button');b.className='logo-option';b.dataset.id=v.id;b.setAttribute('aria-pressed','false');b.setAttribute('aria-label',v.id.toUpperCase()+' '+v.name+'，'+v.family);b.innerHTML=`<span class="option-top"><b>${v.id.toUpperCase()} / ${v.family}</b><span class="choice-check" aria-hidden="true">✓</span></span><div class="logo-art">${svg(v)}</div><span class="option-bottom"><h3>${v.name}</h3><span>查看应用效果 ↓</span></span>`;b.addEventListener('click',()=>select(v));options.append(b);}
  document.querySelectorAll('[data-theme]').forEach(b=>b.addEventListener('click',()=>{document.body.dataset.theme=b.dataset.theme;document.querySelectorAll('[data-theme]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));}));
  select(variants.find(v=>v.id===location.hash.slice(1))||variants[0]);
})().catch(()=>{document.getElementById('options').textContent='请通过本地 HTTP 服务打开此设计稿。';});
