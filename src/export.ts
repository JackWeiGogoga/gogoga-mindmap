/**
 * 导出：把当前画布序列化成自包含的 SVG（连线用原生 path，节点用 foreignObject 内联样式），
 * 再按需光栅化成 PNG。不依赖第三方库。
 */

import type { MindMapCanvas } from "./canvas";
import { t } from "./i18n";

const INLINE_PROPS = [
  "position", "left", "top", "width", "height", "box-sizing", "display", "align-items", "justify-content", "gap", "flex",
  "padding", "margin", "border", "border-radius", "border-bottom", "background-color", "color", "opacity",
  "font-family", "font-size", "font-weight", "font-style", "line-height", "letter-spacing", "text-align", "text-decoration",
  "white-space", "overflow-wrap", "word-break", "max-width", "vertical-align",
  // 展开的备注：超出最大高度的部分照画面裁掉，底部渐隐
  "overflow", "max-height", "mask-image", "-webkit-mask-image",
  "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin",
];

export interface ExportOptions {
  padding?: number;
  /** 传 null 表示透明背景 */
  background?: string | null;
  /** 把页面里 @font-face 声明的字体（比如 Obsidian 自带的 Inter）内嵌进 SVG，默认开 */
  embedFonts?: boolean;
}

const fontCssCache = new Map<string, Promise<string>>();

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error ?? new Error(t("export.readFailed")));
    r.readAsDataURL(blob);
  });
}

/** 收集页面样式表里指定字体族的 @font-face，把字体文件抓下来变成 data URL */
async function collectFontCss(families: string[]): Promise<string> {
  const key = families.join("|").toLowerCase();
  const cached = fontCssCache.get(key);
  if (cached) return cached;
  const task = (async () => {
    const wanted = new Set(families.map((f) => f.toLowerCase()));
    const parts: string[] = [];
    for (const sheet of Array.from(document.styleSheets)) {
      let rules: CSSRuleList;
      try {
        rules = sheet.cssRules;
      } catch {
        continue;
      }
      for (const rule of Array.from(rules)) {
        if (!(rule instanceof CSSFontFaceRule)) continue;
        const fam = rule.style.getPropertyValue("font-family").replace(/["']/g, "").trim();
        if (!wanted.has(fam.toLowerCase())) continue;
        const m = /url\(["']?([^"')]+)["']?\)/.exec(rule.style.getPropertyValue("src"));
        if (!m) continue;
        try {
          const url = new URL(m[1], sheet.href ?? location.href).toString();
          const blob = await (await fetch(url)).blob();
          const data = await blobToDataUrl(blob);
          const style = rule.style.getPropertyValue("font-style") || "normal";
          const weight = rule.style.getPropertyValue("font-weight") || "normal";
          parts.push(`@font-face{font-family:"${fam}";font-style:${style};font-weight:${weight};src:url(${data})}`);
        } catch {
          // 抓不到就退回系统字体
        }
      }
    }
    return parts.join("");
  })();
  fontCssCache.set(key, task);
  return task;
}

let mathCssCache: Promise<string> | null = null;

/**
 * MathJax 的 CHTML 输出靠页面里一张 <style id="MJX-CHTML-styles"> 和自带字体，
 * 进了 SVG 的 foreignObject 就没了。把整张表连同字体（转 data URL）搬进去。
 */
function collectMathJaxCss(): Promise<string> {
  if (mathCssCache) return mathCssCache;
  mathCssCache = (async () => {
    const style = document.getElementById("MJX-CHTML-styles") as HTMLStyleElement | null;
    // 字符规则是 MathJax 用 insertRule 动态加的，textContent 里没有，要从 CSSOM 序列化
    let css = "";
    try {
      css = [...(style?.sheet?.cssRules ?? [])].map((r) => r.cssText).join("\n");
    } catch {
      css = style?.textContent ?? "";
    }
    if (!css) return "";
    const urls = [...new Set([...css.matchAll(/url\(["']?([^"')]+)["']?\)/g)].map((m) => m[1]))];
    for (const url of urls) {
      try {
        const blob = await (await fetch(url)).blob();
        const data = await blobToDataUrl(blob);
        css = css.split(url).join(data);
      } catch {
        // 抓不到的字体就留原样
      }
    }
    return css;
  })();
  return mathCssCache;
}

export interface SvgExport {
  svg: string;
  width: number;
  height: number;
}

function inlineStyles(orig: Element, clone: Element): void {
  const cs = getComputedStyle(orig);
  const target = clone as HTMLElement | SVGElement;
  for (const prop of INLINE_PROPS) {
    const v = cs.getPropertyValue(prop);
    if (v) target.style.setProperty(prop, v);
  }
  const oc = orig.children;
  const cc = clone.children;
  for (let i = 0; i < oc.length; i++) inlineStyles(oc[i], cc[i]);
}

export async function buildSvg(canvas: MindMapCanvas, opts: ExportOptions = {}): Promise<SvgExport> {
  const bounds = canvas.getBounds();
  if (!bounds) throw new Error(t("export.nothing"));
  const pad = opts.padding ?? 32;
  const width = Math.ceil(bounds.w + pad * 2);
  const height = Math.ceil(bounds.h + pad * 2);
  const ox = -bounds.x + pad;
  const oy = -bounds.y + pad;
  const { nodes, edges } = canvas.layers;

  const boxes = [...edges.querySelectorAll<SVGRectElement>("rect.mm-box")]
    .filter((r) => r.style.display !== "none")
    .map((r) => {
      const cs = getComputedStyle(r);
      const a = (k: string) => r.getAttribute(k) ?? "0";
      return `<rect x="${a("x")}" y="${a("y")}" width="${a("width")}" height="${a("height")}" rx="${a("rx")}" fill="${cs.fill}" fill-opacity="${cs.fillOpacity}" stroke="${cs.stroke}" stroke-opacity="${cs.strokeOpacity}" stroke-width="${cs.strokeWidth}" stroke-dasharray="${cs.strokeDasharray}"/>`;
    });
  // 连线和概要的括号；用不上的 path 只是藏起来（display: none）留着复用，不能导出去
  const paths = [...edges.querySelectorAll<SVGPathElement>("path")].filter((p) => p.style.display !== "none" && !p.classList.contains("is-peek")).map((p) => {
    const cs = getComputedStyle(p);
    const d = p.getAttribute("d") ?? "";
    const dash = cs.strokeDasharray && cs.strokeDasharray !== "none" ? ` stroke-dasharray="${cs.strokeDasharray}"` : "";
    // 标注的尖角是填色的三角形，其余都是线
    if (p.classList.contains("mm-callout-tail")) return `<path d="${d}" fill="${cs.fill}" stroke="none"/>`;
    return `<path d="${d}" fill="none" stroke="${cs.stroke}" stroke-width="${cs.strokeWidth}" stroke-linecap="${cs.strokeLinecap}" stroke-linejoin="${cs.strokeLinejoin}"${dash}/>`;
  });

  const clone = nodes.cloneNode(true) as HTMLElement;
  inlineStyles(nodes, clone);
  // 节点里的图片：SVG 图像不能加载外部资源，转成 data URL 内嵌
  const origImgs = nodes.querySelectorAll<HTMLImageElement>("img");
  const cloneImgs = clone.querySelectorAll<HTMLImageElement>("img");
  await Promise.all(
    [...origImgs].map(async (img, i) => {
      try {
        const blob = await (await fetch(img.src)).blob();
        cloneImgs[i].src = await blobToDataUrl(blob);
      } catch {
        cloneImgs[i].remove();
      }
      cloneImgs[i].removeAttribute("srcset");
      cloneImgs[i].style.width = `${img.clientWidth}px`;
      cloneImgs[i].style.height = `${img.clientHeight}px`;
    }),
  );
  // 单行标签禁止换行：导出环境的字体若略宽，宁可溢出也不要多出一行
  const origLabels = nodes.querySelectorAll<HTMLElement>(".mm-label");
  const cloneLabels = clone.querySelectorAll<HTMLElement>(".mm-label");
  origLabels.forEach((label, i) => {
    const lh = parseFloat(getComputedStyle(label).lineHeight) || 20;
    const scale = canvas.el.getBoundingClientRect().width / Math.max(1, canvas.el.clientWidth);
    const h = label.getBoundingClientRect().height / (scale || 1);
    const zoom = (canvas as unknown as { k: number }).k || 1;
    if (h / zoom <= lh * 1.5) cloneLabels[i].setCssStyles({ whiteSpace: "nowrap" });
  });
  clone.querySelectorAll(".mm-toggle:not(.is-folded), .mm-img-handle, .mm-width-handle, .mm-range-handle, .mm-summary-handle, .mm-callout-icon, .mm-callout.is-peek, .mm-note-card-fold, .mm-quiz-tag").forEach((t) => t.remove());
  clone.querySelectorAll(".is-selected, .is-drop-target").forEach((n) => {
    (n as HTMLElement).setCssStyles({ boxShadow: "none" });
  });
  // 去掉类名让导出不依赖插件 CSS；但 MathJax 的字形靠 .mjx-cXXXX::before 的 content 规则，那一棵要保留
  clone.querySelectorAll("[class]").forEach((n) => {
    if (!n.closest("mjx-container")) n.removeAttribute("class");
  });
  clone.querySelectorAll("[contenteditable]").forEach((n) => n.removeAttribute("contenteditable"));
  clone.setCssStyles({ position: "absolute", left: `${ox}px`, top: `${oy}px` });
  const xhtml = new XMLSerializer().serializeToString(clone);

  const bg = opts.background === undefined ? getComputedStyle(canvas.el).backgroundColor : opts.background;
  let fontCss = "";
  if (opts.embedFonts !== false) {
    const families = getComputedStyle(canvas.el).fontFamily.split(",").map((f) => f.replace(/["']/g, "").trim()).filter(Boolean);
    fontCss = await collectFontCss(families);
    if (clone.querySelector("mjx-container")) fontCss += await collectMathJaxCss();
  }
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    (fontCss ? `<defs><style>${fontCss}</style></defs>` : "") +
    (bg ? `<rect width="100%" height="100%" fill="${bg}"/>` : "") +
    `<g transform="translate(${ox} ${oy})">${boxes.join("")}${paths.join("")}</g>` +
    `<foreignObject x="0" y="0" width="${width}" height="${height}">` +
    `<div xmlns="http://www.w3.org/1999/xhtml" style="position:relative;width:${width}px;height:${height}px;overflow:hidden">${xhtml}</div>` +
    `</foreignObject></svg>`;
  return { svg, width, height };
}

export async function svgToPng(exp: SvgExport, scale = 2): Promise<Blob> {
  const img = new Image();
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(exp.svg)}`;
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error(t("export.svgRenderFailed")));
    img.src = url;
  });
  const c = createEl("canvas");
  c.width = Math.round(exp.width * scale);
  c.height = Math.round(exp.height * scale);
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error(t("export.noCanvas"));
  ctx.scale(scale, scale);
  ctx.drawImage(img, 0, 0);
  return new Promise<Blob>((resolve, reject) => {
    c.toBlob((b) => (b ? resolve(b) : reject(new Error(t("export.pngEncodeFailed")))), "image/png");
  });
}
