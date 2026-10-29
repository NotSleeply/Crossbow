/** Validate the shipped B1 binary assets and catalog references, not just source filenames. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const sharp=require(process.env.CROSSBOW_SHARP_MODULE||'sharp');
const root=path.resolve(__dirname,'..'),file=p=>path.join(root,p),read=p=>fs.readFileSync(file(p));
(async()=>{
  const approved=read('docs/designs/2026-10-28-logo/v01/assets/b1.svg');
  assert.equal(read('design/logo/current/mark.svg').toString(),approved.toString(),'Master must be the approved original B1, not a V2 variation');
  const manifest=JSON.parse(read('design/logo/current/manifest.json'));
  for(const f of manifest.files)assert.equal(crypto.createHash('sha256').update(read(f.path)).digest('hex'),f.sha256,f.path+' drifted; regenerate');
  for(const [p,n] of [['apps/desktop/src-tauri/icons/32x32.png',32],['apps/desktop/src-tauri/icons/128x128.png',128],['apps/desktop/src-tauri/icons/128x128@2x.png',256],['apps/desktop/src-tauri/icons/icon-source.png',1024],['apps/site/public/apple-touch-icon.png',180]]){
    const m=await sharp(read(p)).metadata();assert.equal(m.width,n,p);assert.equal(m.height,n,p);
  }
  for(const [name,value] of [['black',0],['white',255]]){
    const p=`design/logo/current/tray/${name}-44.png`;const {data,info}=await sharp(read(p)).ensureAlpha().raw().toBuffer({resolveWithObject:true});let count=0;
    for(let i=0;i<data.length;i+=4)if(data[i+3]){count++;assert.equal(data[i],value,p);assert.equal(data[i+1],value,p);assert.equal(data[i+2],value,p);}
    assert(count>0&&count<info.width*info.height,'Tray must contain a transparent silhouette');
  }
  const ico=read('apps/desktop/src-tauri/icons/icon.ico');assert.equal(ico.readUInt16LE(2),1);const n=ico.readUInt16LE(4);assert(n>=3);let sizes=[];
  for(let i=0;i<n;i++){const o=6+16*i;sizes.push(ico[o]||256);assert(ico.readUInt32LE(o+12)+ico.readUInt32LE(o+8)<=ico.length);}
  for(const s of [16,32,256])assert(sizes.includes(s),'Missing ICO size '+s);
  const icns=read('apps/desktop/src-tauri/icons/icon.icns');assert.equal(icns.toString('ascii',0,4),'icns');assert.equal(icns.readUInt32BE(4),icns.length);
  const catalog='apps/ios/Crossbow/Resources/Assets.xcassets';
  for(const set of ['AppIcon.appiconset','logo-glyph.imageset']){
    const c=JSON.parse(read(`${catalog}/${set}/Contents.json`));for(const img of c.images){assert(fs.existsSync(file(`${catalog}/${set}/${img.filename}`)));}
  }
  const app=await sharp(read(`${catalog}/AppIcon.appiconset/AppIcon.png`)).metadata();assert.equal(app.width,1024);assert.equal(app.hasAlpha,false,'iOS AppIcon must have no alpha channel');
  assert(!fs.existsSync(file('apps/ios/Crossbow/Resources/logo-glyph.png')),'Legacy loose iOS image would shadow the themed catalog');
  console.log(`Verified ${manifest.files.length} B1 assets, transparent templates, ICO sizes, ICNS and opaque iOS catalog.`);
})().catch(e=>{console.error(e.message);process.exit(1);});
