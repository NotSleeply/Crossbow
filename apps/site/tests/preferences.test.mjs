import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";

// Execute the real pre-paint bootstrap: it must agree with saved preferences
// before React loads, including browsers where localStorage is unavailable.
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const bootstrap = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(bootstrap);
function load({ theme, language, systemDark = false, browserLanguage = "en-US", blocked = false } = {}) {
  const root = { dataset: {}, lang: "zh-CN" };
  const meta = {};
  runInNewContext(bootstrap, {
    document: { documentElement: root, querySelector: () => meta },
    localStorage: { getItem: key => {
      if (blocked) throw new Error("Storage denied");
      return key.endsWith("theme") ? theme : language;
    } },
    navigator: { language: browserLanguage },
    matchMedia: () => ({ matches: systemDark }),
  });
  return { theme: root.dataset.theme, language: root.lang, chrome: meta.content };
}
test("saved light appearance overrides a dark system before paint", () => {
  assert.deepEqual(load({ theme: "light", systemDark: true, language: "zh-CN" }), { theme: "light", language: "zh-CN", chrome: "#ffffff" });
});
test("saved dark appearance and English survive a new document", () => {
  assert.deepEqual(load({ theme: "dark", language: "en", browserLanguage: "zh-CN" }), { theme: "dark", language: "en", chrome: "#1a1c21" });
});
test("system and absent preferences use the device appearance", () => {
  for (const theme of [undefined, "system", "invalid"]) {
    assert.equal(load({ theme, systemDark: true }).theme, "dark");
    assert.equal(load({ theme, systemDark: false }).theme, "light");
  }
});
test("unsupported stored language uses a supported browser locale", () => {
  assert.equal(load({ language: "invalid", browserLanguage: "zh-TW" }).language, "zh-CN");
  assert.equal(load({ language: "invalid", browserLanguage: "fr-FR" }).language, "en");
});
test("blocked storage does not prevent startup or theme resolution", () => {
  assert.deepEqual(load({ blocked: true, systemDark: true, browserLanguage: "zh-CN" }), { theme: "dark", language: "zh-CN", chrome: "#1a1c21" });
});
