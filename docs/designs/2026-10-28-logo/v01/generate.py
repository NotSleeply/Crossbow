"""Crossbow brand exploration. Standard library; editable geometry, not generated raster art."""
from pathlib import Path
import json, subprocess
ROOT=Path(__file__).parent
VARIANTS=[
 dict(id='a1',family='名称延续',name='弩线',title='把十字弓，留下最少的笔画。',rationale='以一根箭杆和一段弓臂保留 Crossbow 的名称含义。圆角收束，移除羽毛、装饰弦线和渐变。',tradeoff='与旧标志关联最直接；16px 下交汇处仍比其他方案密集。',geometry='<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M23 28C52 21 79 48 72 77" stroke-width="10"/><path d="M23 28L44 56L72 77" stroke-width="6"/><path d="M25 76L76 25M57 25H76V44" stroke-width="10"/></g>'),
 dict(id='a2',family='名称延续',name='横弩',title='一张弓，一条明确的去向。',rationale='横向弓臂与向右的箭构成一个完整标记。比斜构图安静，更贴合概览页从左向右的连接路径。',tradeoff='在小尺寸下比 A1 清楚；需要一起确认它是否足够像弩，而不是普通箭头。',geometry='<g fill="none" stroke="currentColor" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"><path d="M30 20C64 20 64 80 30 80"/><path d="M20 50H82M68 36L82 50L68 64"/></g>'),
 dict(id='b1',family='连接路径',name='弧路',title='从 Crossbow 的 C，连接出去。',rationale='开放的 C 形弧线包住出口箭头。以“连接”代替武器细节，和白色界面中的圆角控件更协调。',tradeoff='简洁、容易缩小；C 加箭头的语义较通用，需要进一步检索相似商标。',geometry='<g fill="none" stroke="currentColor" stroke-width="11" stroke-linecap="round" stroke-linejoin="round"><path d="M69 24A32 32 0 1 0 69 76"/><path d="M48 50H84M71 37L84 50L71 63"/></g>'),
 dict(id='b2',family='连接路径',name='折径',title='弯过一道规则，抵达目标。',rationale='把规则分流压缩成两条相交的路径。一个明确出口、一条回折线，表达 Crossbow 对连接的整理与选择。',tradeoff='更偏工具与网络语义；转折较多，托盘状态需要单独做光学微调。',geometry='<g fill="none" stroke="currentColor" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"><path d="M23 76V58C23 47 30 40 42 40H79M66 27L79 40L66 53"/><path d="M23 24H39C49 24 55 30 55 40V76"/></g>'),
 dict(id='c1',family='字母标记',name='字印',title='让 C 与 B，成为一个名字。',rationale='将 Crossbow 的首字母压成紧凑的实心字印。依靠留白区分 C 与 B，单色也成立，适合应用列表与 favicon。',tradeoff='小尺寸轮廓稳定；比图形方向更接近字标，十字弓含义减弱。',geometry='<g fill="currentColor"><path d="M49 18H38C20 18 12 32 12 50S20 82 38 82H49V70H38C28 70 24 62 24 50S28 30 38 30H49Z"/><path fill-rule="evenodd" d="M55 18H68C82 18 90 25 90 36C90 42 86 47 81 50C88 53 92 58 92 66C92 77 82 82 68 82H55ZM67 30V44H69C75 44 78 41 78 37S75 30 69 30ZM67 56V70H69C76 70 80 68 80 63S76 56 69 56Z"/></g>'),
 dict(id='c2',family='字母标记',name='双扣',title='两个开放的环，接成一次连接。',rationale='两段相扣的 C 形轮廓，兼有连接与弓臂的曲线。通过上下错位形成整体，避免额外节点和装饰。',tradeoff='最柔和、最抽象；连接类标记较常见，需要检索近似并继续强化辨识度。',geometry='<g fill="none" stroke="currentColor" stroke-width="11" stroke-linecap="round"><path d="M55 23H40A20 20 0 0 0 40 63H47"/><path d="M45 77H60A20 20 0 0 0 60 37H53"/></g>')
]
for v in VARIANTS:
 svg=f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" color="#455ab5"><title>Crossbow {v["name"]}</title>{v["geometry"]}</svg>\n'
 (ROOT/'assets'/f'{v["id"]}.svg').write_text(svg)
 (ROOT/'assets'/f'{v["id"]}-mono.svg').write_text(svg.replace('color="#455ab5"','color="#242b37"'))
 (ROOT/'assets'/f'{v["id"]}-reverse.svg').write_text(svg.replace('color="#455ab5"','color="#e9ebf1"'))
 (ROOT/'assets'/f'{v["id"]}-app.svg').write_text(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" color="#455ab5"><rect x="1" y="1" width="98" height="98" rx="22" fill="#f7f8fb" stroke="#e4e7ee"/><g transform="translate(13 13) scale(.74)">{v["geometry"]}</g></svg>\n')
(ROOT/'variants.json').write_text(json.dumps(VARIANTS,ensure_ascii=False,indent=2)+'\n')
# Local typography; no CDN needed to review the design.
for name in ['manrope-regular.ttf','manrope-semibold.ttf','OFL-Manrope.txt']:
 if not (ROOT/'assets'/name).exists():
  raise FileNotFoundError(f'Restore the bundled font asset: {name}')
