import { test } from "node:test";
import assert from "node:assert/strict";
import { customThemeCss, darkVariant, normalizeCustomTheme, type CustomTheme, type TierStyle } from "../../src/custom-theme";

const tier = (o: Partial<TierStyle> = {}): TierStyle => ({
  fontSize: 14, bold: false, italic: false, color: "#26215c", fill: "#cecbf6", underline: false, radius: 6,
  borderStyle: "solid", borderWidth: 1, borderColor: "#534ab7", maxWidth: null, align: false, lineColor: "#7f77dd", lineWidth: 2, ...o,
});
const theme: CustomTheme = {
  id: "custom-abc", name: "t", base: "snow", edge: "elbow", sharp: false, dashed: false, branchColors: false, spacing: "normal",
  tiers: [tier({ fill: "#3c3489", color: "#ffffff" }), tier({ maxWidth: 120 }), tier({ underline: true, fill: null }), tier()],
};

test("自定义主题样式表：按层级出规则，颜色标记和手动宽度优先，下划线层不画边框", () => {
  const css = customThemeCss([theme]);
  assert.match(css, /\.gg-mm-root\[data-custom="custom-abc"\] \.gg-mm-node\[data-depth="1"\]:not\(\.has-width\):not\(\.has-image\) \{ max-width: 120px; \}/);
  assert.match(css, /\.gg-mm-node\[data-depth="0"\]:not\(\.has-color\):not\(\.is-underline\) \{ background: #3c3489; color: #ffffff; \}/);
  assert.match(css, /\.mm-edge\[data-depth="2"\] \{ stroke: #7f77dd; stroke-width: 2px; \}/);
  assert.ok(!/\.mm-edge\[data-depth="0"\]/.test(css), "中心主题没有入线");
  assert.match(css, /\.gg-mm-node\[data-depth="2"\]:not\(\.is-underline\) \{ border-radius: 6px; border: none; \}/);
  // 深色版本
  assert.match(css, /\.theme-dark \.gg-mm-root\[data-custom="custom-abc"\] \.gg-mm-node\[data-depth="1"\]:not\(\.has-color\)/);
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

test("旧版固定宽度迁移成最大宽度 + 同层对齐；没设过的保持默认", () => {
  const legacy = { ...theme, tiers: theme.tiers.map((t, i) => {
    const { maxWidth: _m, align: _a, ...rest } = t;
    void _m; void _a;
    return { ...rest, width: i === 1 ? 200 : null };
  }) } as unknown as CustomTheme;
  const n = normalizeCustomTheme(legacy);
  assert.equal(n.tiers[1].maxWidth, 200);
  assert.equal(n.tiers[1].align, true);
  assert.equal(n.tiers[2].maxWidth, null);
  assert.equal(n.tiers[2].align, false);
  assert.ok(!("width" in n.tiers[1]));
  // 已是新格式的不动
  assert.deepEqual(normalizeCustomTheme(theme), theme);
});
