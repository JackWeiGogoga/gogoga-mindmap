/**
 * 图标取值的纯逻辑，不碰 obsidian 模块，方便单测。
 * 存进笔记 `icon` 属性的值统一带 `lucide:` 前缀：
 * Notebook Navigator 只有走这一分支才会调 Obsidian 的图标查找，
 * 从而认出插件自己注册的图标；裸名字会被它按内置清单校验后丢掉。
 */

/** getIconIds() 返回的 Lucide 图标带 `lucide-` 前缀，写进属性时要去掉 */
export function bareId(id: string): string {
  return id.startsWith("lucide-") ? id.slice("lucide-".length) : id;
}

/** 把存储值还原成可以交给 setIcon 的图标 id；是 emoji 或别的东西则返回 null */
export function iconIdOf(value: string): string | null {
  const v = value.trim();
  if (!v || v.startsWith("emoji:")) return null;
  const name = v.startsWith("lucide:") ? v.slice("lucide:".length) : v;
  return /^[a-z0-9-]+$/i.test(name) ? name : null;
}

/**
 * 是不是一个 emoji 值。判断必须收紧：属性面板上任何一行 icon 都会走这里，
 * 别人写的可能是网址之类，误判成 emoji 会把它的链接样式也一并抹掉。
 */
export function isEmojiValue(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  if (v.startsWith("emoji:")) return true;
  return v.length <= 8 && /\p{Extended_Pictographic}/u.test(v);
}

export function displayEmoji(value: string): string {
  return value.trim().replace(/^emoji:/, "");
}
