/** 浏览器调试页：不依赖 Obsidian，直接渲染 canvas 并把写回的 Markdown 打印出来。 */
import "./obsidian-shim";
import { MindMapCanvas } from "../src/canvas";
import { buildSvg, svgToPng } from "../src/export";
import { parseMarkdown, serializeMarkdown } from "../src/markdown";
import { setLocale } from "../src/i18n";
import type { Structure } from "../src/layout";
import type { ThemeName } from "../src/theme";

// 界面语言：?lang=en 看英文，默认中文；不读 navigator
setLocale(new URLSearchParams(window.location.search).get("lang") ?? "zh");

const SAMPLE = `---
mindmap: true
---

# 周末露营计划

两天一夜，四个人，开一辆车。

## 装备清单 %%green%%
- 住宿
	- 帐篷 2 顶
	- 睡袋 4 个
	- 防潮垫 4 张
- 炊具
	- 卡式炉 1 台
	- 锅具一套

## 路线与行程 %%blue%%
- 第一天 出发
	- 早上 8 点集合
	- 车程 3 小时
		- 中途在服务区吃午饭，顺便买冰块和饮用水，这一段路况好，可以轮流开 %%blue%%
			- 营地
				- 湖边营位 %%fold%%
					- 风景好
					- 晚上风大
				- 林间营位 %%fold%%
					- 安静
					- 离水源远
			- 活动
				- 环湖徒步 12 km %%red%%
					- 预计 4 小时
					- 带够水
				- 皮划艇 %%red%%
					- 需要提前预约
					- 每小时 80 元
						- 两人一条 %%red%%
				- 观星 %%green fold%%
					- 带上星图
					- 天气晴才去
				- 钓鱼 %%green fold%%
					- 要买钓鱼证
					- 自带鱼竿
- 第二天 返程
	- 收拾营地 1 小时
		- 垃圾带走 %%red%%
		- 检查火源 %%red%%
		- 归还租借装备 %%green%%
		- 拍合照
		- 加油
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
      openLink: (href, internal) => console.debug("open link", href, internal),
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
    onStructureChange: (s) => console.debug("structure ->", s),
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
$("exportSvg").addEventListener("click", () => void (async () => {
  canvas.select(null);
  const { svg, width, height } = await buildSvg(canvas);
  const preview = $("preview");
  preview.setCssStyles({ display: "block" });
  preview.replaceChildren();
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  img.setCssStyles({ maxWidth: "100%" });
  img.title = `${width}×${height}`;
  preview.append(img);
  (window as unknown as { lastSvg: string }).lastSvg = svg;
})());
$("exportPng").addEventListener("click", () => void (async () => {
  canvas.select(null);
  const exp = await buildSvg(canvas);
  const blob = await svgToPng(exp, 2);
  const preview = $("preview");
  preview.setCssStyles({ display: "block" });
  preview.replaceChildren();
  const img = new Image();
  img.src = URL.createObjectURL(blob);
  img.setCssStyles({ maxWidth: "100%" });
  img.title = `${exp.width * 2}×${exp.height * 2} · ${Math.round(blob.size / 1024)} KB`;
  preview.append(img);
  (window as unknown as { lastPngSize: number }).lastPngSize = blob.size;
})());
$("reload").addEventListener("click", () => {
  current = SAMPLE;
  build();
});
build();
