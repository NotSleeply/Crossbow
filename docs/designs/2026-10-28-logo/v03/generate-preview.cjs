const fs=require('fs'),path=require('path');const sharp=require(process.env.CROSSBOW_SHARP_MODULE||'sharp');
const root=path.resolve(__dirname,'../../../..');const read=p=>fs.readFileSync(path.join(root,p));
const img=(p,x,y,w,h=w)=>`<image x="${x}" y="${y}" width="${w}" height="${h}" href="data:image/png;base64,${read(p).toString('base64')}"/>`;
const body=read('design/logo/current/mark.svg').toString().replace(/^.*?<\/title>/s,'').replace(/<\/svg>\s*$/,'');
const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000" viewBox="0 0 1600 1000"><rect width="1600" height="1000" fill="#fff"/>
<g font-family="Arial,Helvetica,sans-serif" fill="#242b37"><text x="80" y="90" font-size="40" font-weight="600">Crossbow</text><text x="1520" y="88" text-anchor="end" font-size="16" fill="#596777">B1 / ORIGINAL ARC / APPROVED</text>
<rect x="80" y="160" width="700" height="360" rx="18" fill="#f7f8fb"/><rect x="800" y="160" width="720" height="360" rx="18" fill="#1a1c21"/>
<g transform="translate(165 245) scale(1.8)" color="#455ab5">${body}</g><text x="375" y="355" font-size="48" font-weight="600">Crossbow</text>
<g transform="translate(900 245) scale(1.8)" color="#b7b4ed">${body}</g><text x="1110" y="355" font-size="48" font-weight="600" fill="#e9ebf1">Crossbow</text>
<text x="112" y="205" font-size="15" fill="#596777">LIGHT / INDIGO #455AB5</text><text x="832" y="205" font-size="15" fill="#adb2be">DARK / LAVENDER #B7B4ED</text>
<rect x="80" y="550" width="440" height="330" rx="18" fill="#f7f8fb"/>${img('design/logo/current/app/icon-256.png',220,605,160)}<text x="300" y="820" text-anchor="middle" font-size="18">macOS / Windows / iOS</text>
<rect x="540" y="550" width="480" height="330" rx="18" fill="#f7f8fb"/>
<rect x="580" y="632" width="400" height="44" rx="8" fill="#e8eaf0"/>${img('design/logo/current/tray/black-44.png',600,643,22)}<text x="635" y="659" font-size="14">Crossbow</text>
<rect x="580" y="692" width="400" height="44" rx="8" fill="#343840"/>${img('design/logo/current/tray/white-44.png',600,703,22)}<text x="635" y="719" font-size="14" fill="#e9ebf1">Crossbow</text><text x="780" y="820" text-anchor="middle" font-size="18">Template tray / 22px</text>
<rect x="1040" y="550" width="480" height="330" rx="18" fill="#f7f8fb"/>
${img('design/logo/current/favicon/favicon-16.png',1110,670,16)}${img('apps/desktop/src-tauri/icons/32x32.png',1180,662,32)}${img('design/logo/current/app/icon-64.png',1290,646,64)}
<text x="1118" y="755" text-anchor="middle" font-size="14" fill="#596777">16px</text><text x="1196" y="755" text-anchor="middle" font-size="14" fill="#596777">32px</text><text x="1322" y="755" text-anchor="middle" font-size="14" fill="#596777">64px</text><text x="1280" y="820" text-anchor="middle" font-size="18">Favicon / Windows tray</text>
<text x="80" y="945" font-size="16" fill="#596777">Approved original B1 geometry. Single source for every platform. 2026-10-28.</text></g></svg>`;
fs.writeFileSync(path.join(__dirname,'brand-sheet.svg'),svg);sharp(Buffer.from(svg)).png().toFile(path.join(__dirname,'previews/brand-sheet.png'));
