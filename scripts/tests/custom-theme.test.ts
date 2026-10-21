import { test } from "node:test";
import assert from "node:assert/strict";
import { customThemeCss, darkVariant, type CustomTheme, type TierStyle } from "../../src/custom-theme";

const tier = (o: Partial<TierStyle> = {}): TierStyle => ({
  fontSize: 14, bold: false, italic: false, color: "#26215c", fill: "#cecbf6", underline: false, radius: 6,
  borderStyle: "solid", borderWidth: 1, borderColor: "#534ab7", width: null, lineColor: "#7f77dd", lineWidth: 2, ...o,
});
const theme: CustomTheme = {
  id: "custom-abc", name: "t", base: "snow", edge: "elbow", sharp: false, dashed: false, branchColors: false, spacing: "normal",
  tiers: [tier({ fill: "#3c3489", color: "#ffffff" }), tier({ width: 120 }), tier({ underline: true, fill: null }), tier()],
};

test("自定义主题样式表：按层级出规则，颜色标记和手动宽度优先，下划线层不画边框", () => {
  const css = customThemeCss([theme]);
  assert.match(css, /\.mm-root\[data-custom="custom-abc"\] \.mm-node\[data-depth="1"\]:not\(\.has-width\) \{ width: 120px; max-width: none; \}/);
  assert.match(css, /\.mm-node\[data-depth="0"\]:not\(\.has-color\):not\(\.is-underline\) \{ background: #3c3489; color: #ffffff; \}/);
  assert.match(css, /\.mm-edge\[data-depth="2"\] \{ stroke: #7f77dd; stroke-width: 2px; \}/);
  assert.ok(!/\.mm-edge\[data-depth="0"\]/.test(css), "中心主题没有入线");
  assert.match(css, /\.mm-node\[data-depth="2"\]:not\(\.is-underline\) \{ border-radius: 6px; border: none; \}/);
  // 深色版本
  assert.match(css, /\.theme-dark \.mm-root\[data-custom="custom-abc"\] \.mm-node\[data-depth="1"\]:not\(\.has-color\)/);
  // 彩虹分支时主主题底色让给分支色
  const rainbow = customThemeCss([{ ...theme, branchColors: true }]);
  assert.ok(!/data-depth="1"\]:not\(\.has-color\):not\(\.is-underline\) \{ background/.test(rainbow));
});

test("深色自动推算：浅底变深、深字变浅、暗线提亮；本来就合适的不动", () => {
  const l = (c: string) => Number(/(\d+)%\)$/.exec(c)?.[1]);
  assert.ok(l(darkVariant("#cecbf6", "fill")) < 30);
  assert.equal(darkVariant("#3c3489", "fill"), "#3c3489");
  assert.ok(l(darkVariant("#26215c", "text")) > 80);
  assert.equal(darkVariant("#ffffff", "text"), "#ffffff");
  assert.ok(l(darkVariant("#2b2b2b", "stroke")) > 60);
});
