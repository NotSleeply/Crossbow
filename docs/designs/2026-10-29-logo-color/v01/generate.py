from pathlib import Path
import json
root=Path(__file__).resolve().parent
repo=root.parents[3]
source=(repo/'design/logo/current/mark.svg').read_text()
tile=(repo/'design/logo/current/app-icon.svg').read_text()
variants=[{'id':'a','name':'当前色','color':'#455AB5','note':'柔和、略偏灰的靛蓝','tag':'对照'}, {'id':'b','name':'鲜明靛蓝','color':'#3F52CF','note':'轻微加深，提高色彩纯度','tag':'推荐'}, {'id':'c','name':'浓郁靛蓝','color':'#3448D8','note':'再浓一档，小尺寸更醒目','tag':'更浓'}]
for v in variants:
 for name,text in [('mark',source),('app-icon',tile)]:
  (root/'assets'/f'{v["id"]}-{name}.svg').write_text(text.replace('#455ab5',v['color']))
(root/'variants.json').write_text(json.dumps(variants,ensure_ascii=False,indent=2)+'\n')
