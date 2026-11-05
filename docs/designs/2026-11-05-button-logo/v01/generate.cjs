const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process');
const sharp=require(process.env.CROSSBOW_SHARP_MODULE||'sharp');
const root=__dirname,repo=path.resolve(root,'../../../..');
const {profileIcns}=require(path.join(repo,'scripts/brand-icon-containers.cjs'));
const source=fs.readFileSync(path.join(repo,'design/logo/current/mark.svg'),'utf8');
const dock=fs.readFileSync(path.join(repo,'design/logo/current/dock-icon.svg'),'utf8');
const colored=(svg,color)=>svg.replace(/color="#[a-fA-F0-9]{6}"/,`color="${color}"`);
const geometry=source.replace(/^.*?<\/title>/s,'').replace(/<\/svg>\s*$/,'');
const rect=(x,y,w,h,c,rx=0)=>`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${c}"/>`;
const text=(x,y,t,size=14,c='#596777',weight=400)=>`<text x="${x}" y="${y}" font-family="Arial,Helvetica,sans-serif" font-size="${size}" fill="${c}" font-weight="${weight}">${t}</text>`;
const mark=(x,y,size,color)=>`<g transform="translate(${x} ${y}) scale(${size/100})" color="${color}">${geometry}</g>`;
const dockMark=(x,y,size,color)=>`<svg x="${x}" y="${y}" width="${size}" height="${size}" viewBox="0 0 100 100" color="${color}">${colored(dock,color).replace(/^<svg[^>]*>/,'').replace(/<\/svg>\s*$/,'')}</svg>`;
function lum(hex){const c=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return c[0]*.2126+c[1]*.7152+c[2]*.0722;}
function contrast(a,b){const [l,h]=[lum(a),lum(b)].sort((a,b)=>a-b);return Number(((h+.05)/(l+.05)).toFixed(2));}
(async()=>{
 fs.mkdirSync(path.join(root,'assets'),{recursive:true});fs.mkdirSync(path.join(root,'previews'),{recursive:true});
 for(const [name,color]of [['button','#293345'],['inverse','#E7EAF2'],['current','#5C6F8B']]){
  const svg=colored(source,color);fs.writeFileSync(path.join(root,`assets/${name}-mark.svg`),svg);
  await sharp(Buffer.from(svg)).resize(512).withIccProfile('srgb').png().toFile(path.join(root,`assets/${name}-mark.png`));
 }
 const d=colored(dock,'#293345');fs.writeFileSync(path.join(root,'assets/dock-icon.svg'),d);
 await sharp(Buffer.from(d)).resize(1024).withIccProfile('srgb').png().toFile(path.join(root,'assets/dock-icon.png'));
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'crossbow-button-icon-'));
 try{
  cp.execFileSync(path.join(repo,'apps/desktop/node_modules/.bin/tauri'),['icon',path.join(root,'assets/dock-icon.png'),'--output',temp],{stdio:'pipe'});
  const icon=await profileIcns(fs.readFileSync(path.join(temp,'icon.icns')),bytes=>sharp(bytes).withIccProfile('srgb').png().toBuffer());
  fs.writeFileSync(path.join(root,'assets/dock-icon.icns'),icon);
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
 let b=rect(0,0,1280,920,'#EEF0F5')+text(32,50,'Crossbow / Primary button colour',30,'#242B37',600)+text(32,80,'#293345 · same B1 shape and Dock safe area',16);
 function panel(x,y,label,color,dark){
  b+=text(x,y,label,15,'#596777',600)+rect(x,y+16,596,160,dark?'#121317':'#FFFFFF',12);
  b+=mark(x+20,y+52,70,color)+text(x+110,y+98,'Crossbow',28,dark?'#E9EBF1':'#242B37',600);
  b+=rect(x+398,y+71,146,36,dark?'#E7EAF2':'#293345',7)+text(x+417,y+95,'Choose node',15,dark?'#20232B':'#FFFFFF',500);
  b+=text(x+22,y+151,color,13,dark?'#ADB2BE':'#596777');
 }
 panel(32,118,'LIGHT / CURRENT SLATE BLUE','#5C6F8B',false);
 panel(652,118,'LIGHT / MATCH THE BUTTON','#293345',false);
 panel(32,338,'DARK / FIXED #293345 — LOW CONTRAST','#293345',true);
 panel(652,338,'DARK / FOLLOW THE BUTTON','#E7EAF2',true);
 b+=text(32,570,'DOCK / SAME #293345 ICON IN LIGHT AND DARK SURROUNDINGS',16,'#242B37',600);
 for(const [i,bg]of ['#D8DBE2','#30343D'].entries()){
  const x=32+i*620;b+=rect(x,592,596,224,bg,16);
  b+=dockMark(x+100,609,130,'#5C6F8B')+dockMark(x+346,609,130,'#293345');
  b+=rect(x+160,747,6,6,i?'#E9EBF1':'#596777',3)+rect(x+408,747,6,6,i?'#E9EBF1':'#596777',3);
  b+=text(x+130,787,'Current A',14,i?'#E9EBF1':'#242B37')+text(x+358,787,'Button ink',14,i?'#E9EBF1':'#242B37');
 }
 b+=text(32,860,`Fixed ink contrast: white ${contrast('#293345','#FFFFFF')}:1 / dark chrome ${contrast('#293345','#121317')}:1`,14);
 b+=text(32,887,'Theme/Dock surface study. The separate native preview app displays the actual Dock icon.',13);
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="920" viewBox="0 0 1280 920">${b}</svg>`;
 fs.writeFileSync(path.join(root,'comparison.svg'),svg);await sharp(Buffer.from(svg)).withIccProfile('srgb').png().toFile(path.join(root,'previews/comparison.png'));
 fs.writeFileSync(path.join(root,'contrast.json'),JSON.stringify({button:'#293345',darkPrimary:'#E7EAF2',fixedOnWhite:contrast('#293345','#FFFFFF'),fixedOnDarkChrome:contrast('#293345','#121317'),inverseOnDarkChrome:contrast('#E7EAF2','#121317')},null,2)+'\n');
 console.log('Rendered theme/Dock study and profiled native preview ICNS.');
})().catch(e=>{console.error(e);process.exit(1)});
