import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import Select from "../../../../apps/desktop/src/components/Select";
import Proxies from "../../../../apps/desktop/src/pages/Proxies";
import mark from "../../../../apps/desktop/src/assets/logo-glyph.png";
import { setLang } from "../../../../apps/desktop/src/i18n";
import "../../../../apps/desktop/src/index.css";
import "./preview.css";
const params = new URLSearchParams(location.search);
if (params.has("dark")) document.documentElement.classList.add("dark");
if (params.has("en")) setLang("en");
function SelectGallery() {
  const [values, setValues] = useState([
    "mihomo",
    "system",
    "zh",
    "7",
    "360",
    "1",
  ]);
  const groups = [
    {
      label: "内核引擎",
      options: [
        { value: "mihomo", label: "mihomo (Clash Meta)" },
        { value: "singbox", label: "sing-box" },
      ],
    },
    {
      label: "主题",
      options: [
        { value: "system", label: "跟随系统" },
        { value: "light", label: "浅色" },
        { value: "dark", label: "深色" },
      ],
    },
    {
      label: "语言",
      options: [
        { value: "zh", label: "简体中文" },
        { value: "en", label: "English" },
      ],
    },
    {
      label: "日志保留时间",
      options: [1, 3, 5, 7, 15, 30].map((n) => ({
        value: n,
        label: `${n} 天`,
      })),
    },
    {
      label: "自动更新",
      options: [
        { value: 0, label: "关闭" },
        { value: 360, label: "每 6 小时" },
        { value: 720, label: "每 12 小时" },
        { value: 1440, label: "每 24 小时" },
      ],
    },
    {
      label: "长列表边缘定位",
      options: Array.from({ length: 40 }, (_, i) => ({
        value: String(i + 1),
        label: i === 5 ? "此项暂不可用" : `测试选项 ${i + 1} · 较长标签验证`,
        disabled: i === 5,
      })),
    },
  ];
  return (
    <section className="preview-gallery">
      <h1>统一选择器</h1>
      {groups.map((g, i) => (
        <div key={g.label}>
          <span>{g.label}</span>
          <Select
            label={g.label}
            value={values[i]}
            options={g.options}
            onChange={(v) =>
              setValues((old) => old.map((x, n) => (n === i ? v : x)))
            }
          />
        </div>
      ))}
      <div>
        <span>不可操作</span>
        <Select
          label="禁用选择器"
          disabled
          value="off"
          options={[{ value: "off", label: "暂不可操作" }]}
          onChange={() => {}}
        />
      </div>
      <div>
        <span>空列表</span>
        <Select label="空选择器" value="" options={[]} onChange={() => {}} />
      </div>
    </section>
  );
}
createRoot(document.getElementById("root")!).render(
  <div className="cb-frame">
    <header className="preview-header">
      <img src={mark} width={25} height={25} alt="" />
      <b>Crossbow</b>
      <nav>
        概览 <strong>节点</strong> 监测 配置 设置
      </nav>
      <small>节点工具栏 · 脱敏预览</small>
    </header>
    <main className="cb-paper">
      <div className="cb-page-content">
        {params.get("view") === "selects" ? <SelectGallery /> : <Proxies />}
      </div>
    </main>
    <footer className="cb-system-foot">
      <span>● 运行中 · 模拟数据</span>
      <span>Crossbow · #{227}</span>
    </footer>
  </div>,
);
