/** 浏览器调试页：不依赖 Obsidian，直接渲染 canvas 并把写回的 Markdown 打印出来。 */
import { MindMapCanvas } from "../src/canvas";
import { buildSvg, svgToPng } from "../src/export";
import { parseMarkdown, serializeMarkdown } from "../src/markdown";
import type { Structure } from "../src/layout";
import type { ThemeName } from "../src/theme";

const SAMPLE = `---
mindmap: true
---

# 佩洛西事件

数据口径：内部审核复盘，2022-08。

## 先发后审8% %%green%%
- 删除率 12%
\t- 总共 53395
\t- 删除 6747

## 先审后发92% %%red%%
- 总体删除率 42%
\t- 总共 578008
\t- 删除 245649
- 未命中关键词的删除率 38%
\t- 总共 310440
\t\t- 先审后发中，未命中关键词占比53%，这是可以转为先发的上限 %%blue%%
\t\t\t- 易盾
\t\t\t\t- 通过删除率 38% %%fold%%
\t\t\t\t\t- 总共 40210
\t\t\t\t\t- 删除 15280
\t\t\t\t- 嫌疑删除率 41% %%fold%%
\t\t\t\t\t- 总共 9930
\t\t\t\t\t- 删除 4071
\t\t\t- 跟贴分区
\t\t\t\t- PUSH分区删除率 78% %%red%%
\t\t\t\t\t- 总共 18055
\t\t\t\t\t- 删除 14221
\t\t\t\t- 预审分区删除率 48% %%red%%
\t\t\t\t\t- 总共 203192
\t\t\t\t\t- 删除 98504
\t\t\t\t\t\t- 一级3类删除率 76% %%red%%
\t\t\t\t- IP限制区删除率 9% %%green fold%%
\t\t\t\t\t- 总共 12000
\t\t\t\t\t- 删除 1080
\t\t\t\t- 风险嫌疑删除率 10% %%green fold%%
\t\t\t\t\t- 总共 8000
\t\t\t\t\t- 删除 800
\t\t\t\t- 必审用户删除率 7% %%green fold%%
\t\t\t\t\t- 总共 5000
\t\t\t\t\t- 删除 350
\t\t\t\t- 军事历史删除率 12% %%green fold%%
\t\t\t\t\t- 总共 3000
\t\t\t\t\t- 删除 360
\t\t\t\t- 时政分区删除率 7% %%green fold%%
\t\t\t\t\t- 总共 20000
\t\t\t\t\t- 删除 1400
- 删除 120596
\t- 有审核理由 10743
\t\t- 涉习 8 %%red%%
\t\t- 涉政 1128 %%red%%
\t\t- 指示 315 %%red%%
\t\t- 生态 9001 %%green%%
\t\t- 色情 90
\t\t- 违禁 211
`;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const out = $<HTMLPreElement>("out");
const mapEl = $<HTMLDivElement>("map");
const history: string[] = [];
let future: string[] = [];
let current = SAMPLE;

let canvas: MindMapCanvas;

function build() {
  canvas?.destroy();
  mapEl.replaceChildren();
  canvas = new MindMapCanvas(mapEl, {
    structure: $<HTMLSelectElement>("structure").value as Structure,
    theme: $<HTMLSelectElement>("theme").value as ThemeName,
    editable: $<HTMLInputElement>("editable").checked,
    host: {
      openLink: (href, internal) => console.log("open link", href, internal),
    },
    onChange: (doc) => {
      history.push(current);
      future = [];
      current = serializeMarkdown(doc);
      out.textContent = current;
    },
    onUndo: () => {
      const prev = history.pop();
      if (prev === undefined) return;
      future.push(current);
      current = prev;
      canvas.setDoc(parseMarkdown(current, { fallbackTitle: "样例" }));
      out.textContent = current;
    },
    onRedo: () => {
      const next = future.pop();
      if (next === undefined) return;
      history.push(current);
      current = next;
      canvas.setDoc(parseMarkdown(current, { fallbackTitle: "样例" }));
      out.textContent = current;
    },
    onStructureChange: (s) => console.log("structure ->", s),
  });
  canvas.setDoc(parseMarkdown(current, { fallbackTitle: "样例" }));
  out.textContent = current;
  (window as unknown as { canvas: MindMapCanvas }).canvas = canvas;
}

$("theme").addEventListener("change", () => canvas.setTheme($<HTMLSelectElement>("theme").value as ThemeName));
$("structure").addEventListener("change", () => canvas.setStructure($<HTMLSelectElement>("structure").value as Structure));
$("dark").addEventListener("change", () => {
  document.body.classList.toggle("theme-dark", $<HTMLInputElement>("dark").checked);
  document.body.classList.toggle("theme-light", !$<HTMLInputElement>("dark").checked);
});
$("editable").addEventListener("change", build);
$("exportSvg").addEventListener("click", async () => {
  canvas.select(null);
  const { svg, width, height } = await buildSvg(canvas);
  const preview = $("preview");
  preview.style.display = "block";
  preview.replaceChildren();
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  img.style.maxWidth = "100%";
  img.title = `${width}×${height}`;
  preview.append(img);
  (window as unknown as { lastSvg: string }).lastSvg = svg;
});
$("exportPng").addEventListener("click", async () => {
  canvas.select(null);
  const exp = await buildSvg(canvas);
  const blob = await svgToPng(exp, 2);
  const preview = $("preview");
  preview.style.display = "block";
  preview.replaceChildren();
  const img = new Image();
  img.src = URL.createObjectURL(blob);
  img.style.maxWidth = "100%";
  img.title = `${exp.width * 2}×${exp.height * 2} · ${Math.round(blob.size / 1024)} KB`;
  preview.append(img);
  (window as unknown as { lastPngSize: number }).lastPngSize = blob.size;
});
$("reload").addEventListener("click", () => {
  current = SAMPLE;
  build();
});
build();
