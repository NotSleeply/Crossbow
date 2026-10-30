import "../../../../apps/desktop/src/index.css";
import glyph from "../../../../apps/desktop/src/assets/logo-glyph.png";
import icon from "../../../../apps/desktop/src-tauri/icons/128x128@2x.png";
import web from "../../../../apps/site/src/assets/logo-glyph.png";
import favicon from "../../../../apps/site/public/favicon-32.png";
import ios from "../../../../apps/ios/Crossbow/Resources/Assets.xcassets/AppIcon.appiconset/AppIcon.png";
import "./style.css";
document.querySelectorAll(".proof-mark").forEach((el) => {
  el.style.maskImage = 'url("' + glyph + '")';
  el.style.webkitMaskImage = 'url("' + glyph + '")';
});
for (const [selector, src] of [
  [".app-export", icon],
  [".web-mark", web],
  [".favicon-export", favicon],
  [".ios-export", ios],
])
  document.querySelector(selector).src = src;
