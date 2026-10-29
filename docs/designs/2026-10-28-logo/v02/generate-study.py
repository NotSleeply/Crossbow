from pathlib import Path
import shutil,json
base=Path(__file__).resolve().parent.parent
v1=base/'v01'; v2=base/'v02';(v2/'assets').mkdir(parents=True,exist_ok=True);(v2/'previews').mkdir(exist_ok=True)
variants=[
 dict(id='b1-01',family='B1 深化 / 圆弧',name='圆弧',english='ROUND',title='留住 B1，放松一点呼吸。',rationale='保留最接近原 B1 的开放 C 与水平箭头。适度收细笔画，拉开弧端与箭头之间的留白，保持轻巧。',tradeoff='最接近你选中的 B1；方向明确，但 C 加箭头的构形较通用。',geometry='<g fill="none" stroke="currentColor" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"><path d="M70 24A32 32 0 1 0 70 76"/><path d="M48 50H83M71 38L83 50L71 62"/></g>'),
 dict(id='b1-02',family='B1 深化 / 方圆',name='方圆',english='SOFT SQUARE',title='把弧线，收进界面的秩序。',rationale='把圆形 C 改成圆角矩形轮廓。横竖更稳定，和 Crossbow 的窗口、卡片与控件呼应，依旧保持向右的出口。',tradeoff='偏理性、工具感更强；圆形的流动感稍弱。',geometry='<g fill="none" stroke="currentColor" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"><path d="M71 23H41C26 23 19 32 19 47V53C19 68 26 77 41 77H71"/><path d="M47 50H84M72 38L84 50L72 62"/></g>'),
 dict(id='b1-03',family='B1 深化 / 连笔',name='连笔',english='CONTINUOUS',title='一段连接，不再分开。',rationale='让下方弧线自然接入箭头，用连续的走向把 C 和出口连成整体。没有分离的小部件，字标组合更紧凑。',tradeoff='整体感强；更容易读成 G，需要结合 Crossbow 字标使用来判断。',geometry='<g fill="none" stroke="currentColor" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"><path d="M70 24C56 13 35 17 24 32C12 50 20 73 39 80C53 85 69 80 77 69C82 62 84 56 84 50H48"/><path d="M71 37L84 50L71 63"/></g>'),
 dict(id='b1-04',family='B1 深化 / 负形',name='留白',english='COUNTERFORM',title='连接的方向，藏在留白里。',rationale='从实心圆环中切出出口箭头，让负形承担方向信息。减少细线，获得更扎实的体块，适合应用图标与小尺寸。',tradeoff='轮廓最厚实，视觉重量更高；需要确认你是否喜欢偏实心的风格。',geometry='<defs><mask id="cutout" maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100"><rect width="100" height="100" fill="white"/><circle cx="50" cy="50" r="22" fill="black"/><path d="M47 41H66V30L93 50L66 70V59H47Z" fill="black"/></mask></defs><circle cx="50" cy="50" r="38" fill="currentColor" mask="url(#cutout)"/>'),
 dict(id='b1-05',family='B1 深化 / 破界',name='破界',english='OUTWARD',title='沿着 C，向外多走一步。',rationale='把出口转向右上，箭头从 C 的开口穿出。保留连接的语义，同时增加一点向前的张力，适合更有个性的标记。',tradeoff='方向感最强；与外链符号的语义接近，需要留意独特性。',geometry='<g fill="none" stroke="currentColor" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"><path d="M62 28A30 30 0 1 0 71 65"/><path d="M45 55L82 18M64 18H82V36"/></g>'),
 dict(id='b1-06',family='B1 深化 / 弓弧',name='弓弧',english='BOW ARC',title='一段 C 形弓臂，保留 Crossbow 的名字。',rationale='在 C 的开口中加入一段简化弓弦，再让箭头从中穿过。沿着你喜欢的 B1 轮廓，重新找回一点十字弓含义。',tradeoff='品牌名称关联更强；16px 下交汇处会更密，后续需做托盘专用光学稿。',geometry='<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M71 22C48 22 25 32 25 50S48 78 71 78" stroke-width="10"/><path d="M71 22L51 50L71 78" stroke-width="6"/><path d="M38 50H84M68 34L84 50L68 66" stroke-width="9"/></g>')
]
# Each SVG remains independent, transparent, and recolorable.
for v in variants:
 svg=f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" color="#455ab5"><title>Crossbow {v["name"]}</title>{v["geometry"]}</svg>\n'
 for suffix,color in [('', '#455ab5'),('-mono','#242b37'),('-reverse','#e9ebf1')]: (v2/'assets'/f'{v["id"]}{suffix}.svg').write_text(svg.replace('color="#455ab5"',f'color="{color}"'))
 (v2/'assets'/f'{v["id"]}-app.svg').write_text(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" color="#455ab5"><rect x="1" y="1" width="98" height="98" rx="22" fill="#f7f8fb" stroke="#e4e7ee"/><g transform="translate(13 13) scale(.74)">{v["geometry"]}</g></svg>\n')
for name in ['manrope-regular.ttf','manrope-semibold.ttf','OFL-Manrope.txt']: shutil.copyfile(v1/'assets'/name,v2/'assets'/name)
(v2/'variants.json').write_text(json.dumps(variants,ensure_ascii=False,indent=2)+'\n')
shutil.copyfile(v1/'style.css',v2/'style.css')
s=(v1/'index.html').read_text().replace('设计探索 V1','设计探索 V2').replace('品牌设计 / V1','V2 / B1 深化').replace('同一个 Crossbow，<br>更清晰的标记。','沿着弧线，<br>找到 Crossbow。').replace('减去细碎的弓弦与渐变。<br>让标志融入现在的界面，<br>也经得起托盘里的一眼。','以你喜欢的 B1 为起点。<br>保留 C 形轮廓与出口方向，<br>在六种构形里，选一个更像我们。').replace('三个方向，六个提案','B1 方向，六种深化').replace('Crossbow · Logo 提案，未替换正式图标','Crossbow · Logo V2 提案，未替换正式图标')
(v2/'index.html').write_text(s)
s=(v1/'showcase.js').read_text().replace("function svg(v){return `<svg", "let svgSerial=0;\n  function svg(v){let geo=v.geometry.replaceAll('cutout','cutout-'+(++svgSerial));return `<svg").replace('${v.geometry}</svg>','${geo}</svg>')
(v2/'showcase.js').write_text(s)
# A stable SVG contact sheet complements the responsive live presentation.
for folder in [v1,v2]:
 data=json.loads((folder/'variants.json').read_text());label='V1 · SIX DIRECTIONS' if folder==v1 else 'V2 · B1 EXPLORATION'
 sheet=['<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1160" viewBox="0 0 1600 1160"><rect width="1600" height="1160" fill="#fff"/><g font-family="Arial,Helvetica,sans-serif" fill="#242b37"><text x="80" y="95" font-size="42" font-weight="600">Crossbow</text><text x="1520" y="93" text-anchor="end" font-size="17" fill="#596777">'+label+'</text><text x="80" y="144" font-size="18" fill="#596777">Indigo / Graphite / Current app palette</text></g>']
 for i,v in enumerate(data):
  x=80+(i%3)*490;y=200+(i//3)*410
  geo=v['geometry'].replace('cutout',f'sheet-cutout-{i}')
  sheet.append(f'<g transform="translate({x} {y})"><rect width="460" height="380" rx="18" fill="#f7f8fb"/><text x="28" y="46" font-family="Arial,sans-serif" font-size="17" fill="#596777">{v["id"].upper()}</text><g transform="translate(145 85) scale(1.7)" color="#455ab5">{geo}</g><text x="230" y="330" text-anchor="middle" font-family="Arial,sans-serif" font-size="18" fill="#242b37">{v.get("english",v["name"]) if 'english' in v else ['CROSSBOW','HORIZONTAL BOW','OPEN ARC','ROUTING','CB MONOGRAM','LINK'][i]}</text></g>')
 sheet.append('<text x="80" y="1100" font-family="Arial,sans-serif" font-size="16" fill="#596777">Crossbow logo study · 2026-10-28 · Draft, not a production asset</text></svg>')
 (folder/'contact-sheet.svg').write_text(''.join(sheet))
