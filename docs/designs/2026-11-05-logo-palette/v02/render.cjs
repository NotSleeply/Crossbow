// Render a contact sheet from the actual generated production PNG/ICNS/ICO bytes.
const fs=require('node:fs'),path=require('node:path');
const sharp=require(process.env.CROSSBOW_SHARP_MODULE||'sharp');
const root=__dirname,repo=path.resolve(root,'../../../..');
const read=p=>fs.readFileSync(path.join(repo,p));
async function largest(frames){const sized=await Promise.all(frames.map(async bytes=>({bytes,width:(await sharp(bytes).metadata()).width})));return sized.sort((a,b)=>b.width-a.width)[0].bytes;}
async function icns(p){const bytes=read(p),frames=[];for(let i=8;i<bytes.length;){const length=bytes.readUInt32BE(i+4),data=bytes.subarray(i+8,i+length);if(data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))frames.push(data);i+=length;}return largest(frames);}
async function ico(p){const bytes=read(p),frames=[];for(let i=0;i<bytes.readUInt16LE(4);i++){const offset=6+i*16,start=bytes.readUInt32LE(offset+12),length=bytes.readUInt32LE(offset+8);frames.push(bytes.subarray(start,start+length));}return largest(frames);}
const rect=(x,y,w,h,c,rx=0)=>`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${c}"/>`;
const text=(x,y,t,size=16,c='#596777',weight=400)=>`<text x="${x}" y="${y}" font-family="Arial,Helvetica,sans-serif" font-size="${size}" fill="${c}" font-weight="${weight}">${t}</text>`;
const image=(x,y,size,bytes)=>`<image x="${x}" y="${y}" width="${size}" height="${size}" href="data:image/png;base64,${bytes.toString('base64')}"/>`;
(async()=>{
 let body=rect(0,0,1200,760,'#EEF0F5')+text(32,48,'Crossbow / A · Slate blue',28,'#242B37',600)+text(32,78,'Production assets · #5C6F8B · same colour across all themes',15);
 const glyph=read('apps/desktop/src/assets/logo-glyph.png');
 body+=rect(32,106,556,142,'#FFFFFF',12)+rect(612,106,556,142,'#121317',12);
 body+=image(56,140,72,glyph)+text(150,185,'Crossbow',30,'#242B37',600);
 body+=image(636,140,72,glyph)+text(730,185,'Crossbow',30,'#E9EBF1',600);
 const cells=[['macOS Dock / ICNS',await icns('apps/desktop/src-tauri/icons/dock-icon.icns')],['macOS app / ICNS',await icns('apps/desktop/src-tauri/icons/icon.icns')],['Windows / ICO',await ico('apps/desktop/src-tauri/icons/icon.ico')],['iOS / AppIcon',read('apps/ios/Crossbow/Resources/Assets.xcassets/AppIcon.appiconset/AppIcon.png')]];
 for(const [i,[label,bytes]]of cells.entries()){const x=32+i*290;body+=rect(x,272,266,274,'#FFFFFF',12)+text(x+18,306,label,16,'#242B37',500)+image(x+57,334,152,bytes)+text(x+18,522,'Embedded sRGB / production file',11);}
 body+=rect(32,570,1136,142,'#FFFFFF',12)+text(52,604,'Website / favicon',16,'#242B37',500)+image(65,626,48,read('apps/site/public/favicon-32.png'));
 body+=text(260,604,'Tray templates / unchanged',16,'#242B37',500)+image(272,628,44,read('apps/desktop/src-tauri/icons/tray-icon.png'))+rect(334,626,50,50,'#23262D',6)+image(337,629,44,read('design/logo/current/tray/white-44.png'));
 body+=text(500,615,'B1 geometry and Dock safe area retained.',16,'#242B37',500)+text(500,646,'ICNS / ICO images above are decoded from the generated native containers.',12)+text(500,674,'Resource preview, not a screenshot of the installed application.',12);
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="760" viewBox="0 0 1200 760">${body}</svg>`;
 fs.mkdirSync(path.join(root,'previews'),{recursive:true});fs.writeFileSync(path.join(root,'production-assets.svg'),svg);
 await sharp(Buffer.from(svg)).withIccProfile('srgb').png().toFile(path.join(root,'previews/production-assets.png'));
 console.log('Rendered actual production glyphs and decoded ICNS/ICO representations.');
})().catch(error=>{console.error(error);process.exit(1)});
