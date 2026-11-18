// esbuild 把 .md 当文本打进包里（见 esbuild.config.mjs 的 loader）
declare module "*.md" {
  const text: string;
  export default text;
}
