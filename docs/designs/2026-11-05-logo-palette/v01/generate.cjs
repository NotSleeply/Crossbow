// Code-native SVG colour study. Geometry comes verbatim from the approved B1 source.
const fs=require('node:fs'),path=require('node:path');
const sharp=require(process.env.CROSSBOW_SHARP_MODULE||'sharp');
const root=__dirname,repo=path.resolve(root,'../../../..');
const palette=JSON.parse(fs.readFileSync(path.join(root,'palette.json'),'utf8'));
const source=fs.readFileSync(path.join(repo,'design/logo/current/mark.svg'),'utf8');
const dock=fs.readFileSync(path.join(repo,'design/logo/current/dock-icon.svg'),'utf8');
const tile=fs.readFileSync(path.join(repo,'design/logo/current/app-icon.svg'),'utf8');
const geometry=source.replace(/^.*?<\/title>/s,'').replace(/<\/svg>\s*$/,'');
const colored=(svg,color)=>svg.replace(/color="#[a-fA-F0-9]{6}"/,`color="${color}"`);
const write=(file,value)=>fs.writeFileSync(path.join(root,file),value);
const svg=(inner,w,h)=>`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${inner}</svg>`;
const rect=(x,y,w,h,fill,rx=0,stroke='none')=>`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}" stroke="${stroke}"/>`;
const text=(x,y,label,size=14,fill='#596777',weight=400)=>`<text x="${x}" y="${y}" font-family="Arial,Helvetica,sans-serif" font-size="${size}" fill="${fill}" font-weight="${weight}">${label}</text>`;
const mark=(x,y,size,color)=>`<g transform="translate(${x} ${y}) scale(${size/100})" color="${color}">${geometry}</g>`;
const dockMark=(x,y,size,color)=>`<svg x="${x}" y="${y}" width="${size}" height="${size}" viewBox="0 0 100 100" color="${color}">${colored(dock,color).replace(/^<svg[^>]*>/,'').replace(/<\/svg>\s*$/,'')}</svg>`;
function luminance(color){const c=[1,3,5].map(i=>parseInt(color.slice(i,i+2),16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return c[0]*.2126+c[1]*.7152+c[2]*.0722;}
function contrast(a,b){const [lo,hi]=[luminance(a),luminance(b)].sort((a,b)=>a-b);return Number(((hi+.05)/(lo+.05)).toFixed(2));}
async function png(svgFile,pngFile,width){await sharp(path.join(root,svgFile)).resize({width}).withIccProfile('srgb').png().toFile(path.join(root,pngFile));}
(async()=>{
 fs.mkdirSync(path.join(root,'assets'),{recursive:true});fs.mkdirSync(path.join(root,'previews'),{recursive:true});
 const all=[palette.current,...palette.proposals];
 for(const p of all){
  write(`assets/${p.id}-mark.svg`,colored(source,p.color));
  write(`assets/${p.id}-dock.svg`,colored(dock,p.color));
  write(`assets/${p.id}-app.svg`,colored(tile,p.color));
  await png(`assets/${p.id}-mark.svg`,`assets/${p.id}-mark-256.png`,256);
  await png(`assets/${p.id}-dock.svg`,`assets/${p.id}-dock-128.png`,128);
 }
 let board=rect(0,0,1440,1120,'#EEF0F5');
 board+=text(40,59,'Crossbow / Color study',32,'#242B37',600);
 board+=text(40,91,'B1 geometry retained. One colour across light, dark and the Dock.',16);
 board+=mark(1115,25,53,palette.current.color)+text(1180,45,'CURRENT',11)+text(1180,69,palette.current.color,17,'#242B37',500);
 palette.proposals.forEach((p,i)=>{
  const x=40+(i%3)*461,y=126+Math.floor(i/3)*466,w=437;
  board+=rect(x,y,w,442,'#FFFFFF',14,p.id==='A'?'#5C6F8B':'#D9DEE7');
  board+=text(x+24,y+39,`${p.id} / ${p.en}`,19,'#242B37',600);
  board+=text(x+24,y+66,p.color,14);
  if(p.id==='A')board+=text(x+295,y+39,'RECOMMENDED',10,'#5C6F8B',600);
  board+=rect(x+16,y+88,198,170,'#EEF0F5',8)+rect(x+222,y+88,199,170,'#121317',8);
  board+=text(x+30,y+111,'LIGHT',10)+text(x+236,y+111,'DARK',10,'#ADB2BE');
  board+=mark(x+74,y+127,82,p.color)+mark(x+279,y+127,82,p.color);
  board+=text(x+63,y+235,'Crossbow',18,'#242B37',600)+text(x+268,y+235,'Crossbow',18,'#E9EBF1',600);
  board+=dockMark(x+31,y+284,100,p.color);
  board+=text(x+151,y+314,'Same Dock safe area',14,'#242B37',500);
  board+=text(x+151,y+339,'No gradient. No geometry change.',12);
  board+=rect(x+151,y+361,32,10,'#293345',3)+rect(x+189,y+361,32,10,'#455AB5',3)+rect(x+227,y+361,32,10,'#546ABF',3);
  board+=text(x+24,y+416,`White ${contrast(p.color,'#FFFFFF')}:1  /  Dark surface ${contrast(p.color,'#1A1C21')}:1`,12);
 });
 board+=text(40,1090,'Application context: primary #293345 / accent #455AB5 / canvas #EEF0F5',14);
 write('comparison.svg',svg(board,1440,1120));await png('comparison.svg','previews/comparison.png',1440);
 // A closer side-by-side against the existing logo, at realistic header and Dock sizes.
 let detail=rect(0,0,1200,660,'#EEF0F5');
 detail+=text(32,48,'Current colour → A / Slate blue',27,'#242B37',600);
 for(const [i,p]of [palette.current,palette.proposals[0]].entries()){
  const x=32+i*584;
  detail+=text(x,90,`${p.id==='A'?'A / SLATE BLUE':'CURRENT'}  ${p.color}`,16,'#596777',600);
  detail+=rect(x,112,552,112,'#FFFFFF',10)+mark(x+18,133,66,p.color)+text(x+100,179,'Crossbow',28,'#242B37',600);
  detail+=rect(x+360,147,110,36,'#293345',7)+text(x+383,170,'Connect',15,'#FFFFFF',500);
  detail+=rect(x,244,552,112,'#121317',10)+mark(x+18,265,66,p.color)+text(x+100,311,'Crossbow',28,'#E9EBF1',600);
  detail+=rect(x+360,279,110,36,'#E7EAF2',7)+text(x+383,302,'Connect',15,'#20232B',500);
  detail+=rect(x,376,552,230,'#FFFFFF',10)+dockMark(x+26,408,152,p.color);
  detail+=text(x+205,458,'Dock / same icon size',18,'#242B37',500)+text(x+205,488,'Original inset and sRGB export.',14);
 }
 write('recommended.svg',svg(detail,1200,660));await png('recommended.svg','previews/recommended.png',1440);
 write('contrast.json',JSON.stringify(all.map(p=>({id:p.id,color:p.color,white:contrast(p.color,'#FFFFFF'),lightChrome:contrast(p.color,'#EEF0F5'),darkChrome:contrast(p.color,'#121317'),darkSurface:contrast(p.color,'#1A1C21'),darkPanel:contrast(p.color,'#23262D')})),null,2)+'\n');
 console.log('Rendered six SVG colour proposals and sRGB comparison PNGs.');
})().catch(error=>{console.error(error);process.exit(1)});
