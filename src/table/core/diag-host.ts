/**
 * 诊断记录接到 Obsidian 上（只在电脑端，见 diag.ts）：建实例、环境信息、异常提示和「恢复为新笔记」、
 * 插件自己的报错、Markdown 视图那边的存盘 / 外部改动、设置页的几行。
 * 两个插件共用（源头在脑图，sync-table 复制给表格）。
 */
import { type App, apiVersion, getLanguage, MarkdownView, Modal, Notice, Platform, type Plugin, Setting, type SettingDefinition, TFile } from "obsidian";
import { DETAILED_DAYS, Diag, type DiagEvent, type DiagOrigin, hashText, type Incident } from "./diag";

const zh = () => getLanguage().toLowerCase().startsWith("zh");
const L = (c: string, e: string) => (zh() ? c : e);

const REASON: Record<string, [string, string]> = {
  empty: ["变成了空的", "became empty"],
  shrink: ["一次少了三成以上", "lost over 30% at once"],
  damage: ["疑似被拼坏（标签不配对、行被拼在一起）", "looks garbled (unpaired tags, lines spliced together)"],
  conflict: ["和外部的改动冲突", "conflicted with an outside change"],
};

type PluginsApi = { plugins: Record<string, { diag?: Diag | null } | undefined>; enabledPlugins: Set<string>; manifests: Record<string, { version: string } | undefined> };
const pluginsOf = (app: App) => (app as unknown as { plugins: PluginsApi }).plugins;

/** 另一个 gogoga 插件的诊断实例（两个插件的事件合起来才看得出谁写的） */
export function peerDiags(app: App, self: Diag): Diag[] {
  const out: Diag[] = [];
  for (const id of ["gogoga-mindmap", "gogoga-table"]) {
    const d = pluginsOf(app).plugins[id]?.diag;
    if (d && d !== self) out.push(d);
  }
  return out;
}

/** 电脑端建一个诊断实例；手机上返回 null，什么都不做 */
export function createDiag(app: App, plugin: Plugin, src: string): Diag | null {
  if (!Platform.isDesktopApp) return null;
  const basePath = (app.vault.adapter as unknown as { basePath?: string }).basePath ?? app.vault.getName();
  const key = `${app.vault.getName().replace(/[^\p{L}\p{N}_-]+/gu, "_").slice(0, 40)}-${hashText(basePath).slice(0, 6)}`;
  const env = () => {
    const ps = pluginsOf(app);
    let installer: string | undefined;
    try {
      // 安装器版本：和 Obsidian「显示调试信息」取的同一个
      const req = (window as unknown as { require?: (m: string) => unknown }).require;
      const v = (req?.("electron") as { ipcRenderer?: { sendSync(c: string): unknown } } | undefined)?.ipcRenderer?.sendSync("version");
      installer = typeof v === "string" ? v : undefined;
    } catch {
      installer = undefined;
    }
    const sync = (app as unknown as { internalPlugins?: { getPluginById?(id: string): { enabled?: boolean } | null } }).internalPlugins?.getPluginById?.("sync");
    return {
      plugin: src,
      version: plugin.manifest.version,
      obsidian: apiVersion,
      installer,
      platform: (window as unknown as { process?: { platform: string } }).process?.platform,
      obsidianSync: !!sync?.enabled,
      plugins: [...(ps?.enabledPlugins ?? [])].sort().map((id) => `${id}@${ps.manifests[id]?.version ?? "?"}`),
    };
  };
  let diag: Diag | null = null;
  const shown = new Map<string, number>();
  diag = new Diag(src, key, env, (inc, before) => {
    // 只在看起来不是用户自己删的时候提示：拼坏、合并冲突、外部（同步、git、别的程序）把它清空或删掉一大块
    const loud = inc.reason === "damage" || inc.reason === "conflict" || (inc.origin === "external" && (inc.reason === "empty" || inc.reason === "shrink"));
    if (!loud) return;
    const last = shown.get(inc.file) ?? 0;
    if (Date.now() - last < 60_000) return;
    shown.set(inc.file, Date.now());
    incidentNotice(app, inc, before, diag!);
  });
  // 插件自己的报错（调用栈里有这个插件）
  const mine = (stack: string | undefined) => !!stack && stack.includes(`plugin:${plugin.manifest.id}`);
  plugin.registerDomEvent(window, "error", (ev: ErrorEvent) => {
    const err = ev.error as Error | undefined;
    if (mine(err?.stack)) diag?.log("error", { message: String(ev.message).slice(0, 300), stack: err?.stack?.slice(0, 1500) });
  });
  plugin.registerDomEvent(window, "unhandledrejection", (ev: PromiseRejectionEvent) => {
    const err = ev.reason as Error | undefined;
    if (mine(err?.stack)) diag?.log("error", { message: String(err?.message ?? ev.reason).slice(0, 300), stack: err?.stack?.slice(0, 1500), rejection: true });
  });
  diag.log("session", env());
  plugin.register(() => {
    diag?.log("unload", { version: plugin.manifest.version });
    diag?.flush();
  });
  return diag;
}

function incidentNotice(app: App, inc: Incident, before: string, diag: Diag): void {
  const name = inc.file.split("/").pop() ?? inc.file;
  const frag = createFragment((f) => {
    f.createDiv({ text: L(`「${name}」的内容${REASON[inc.reason]?.[0] ?? inc.reason}。已在本机保存一份变化前的副本。`, `"${name}" ${REASON[inc.reason]?.[1] ?? inc.reason}. A copy from before the change was saved on this computer.`) });
    const row = f.createDiv({ cls: "gg-diag-notice-actions" });
    if (diag.config().saveContent) {
      const b = row.createEl("button", { text: L("恢复为新笔记", "Restore as a new note") });
      b.addEventListener("click", () => void restoreAsNote(app, inc.file, before));
    }
    const o = row.createEl("button", { text: L("打开诊断文件夹", "Open diagnostics folder") });
    o.addEventListener("click", () => openFolder(inc.dir));
  });
  new Notice(frag, 0);
}

/** 变化前的内容存成旁边的一篇新笔记，不动原来那篇 */
async function restoreAsNote(app: App, path: string, text: string): Promise<void> {
  const dot = path.lastIndexOf(".");
  const stem = dot > 0 ? path.slice(0, dot) : path;
  const ext = dot > 0 ? path.slice(dot) : ".md";
  const d = new Date();
  const p = (x: number) => String(x).padStart(2, "0");
  let target = `${stem} (${L("恢复", "restored")} ${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())})${ext}`;
  for (let i = 2; app.vault.getAbstractFileByPath(target); i++) target = target.replace(/( \d+)?\)(\.[^.]+)$/, ` ${i})$2`);
  const f = await app.vault.create(target, text);
  await app.workspace.getLeaf("tab").openFile(f);
}

function openFolder(dir: string | null): void {
  if (!dir) return;
  try {
    const req = (window as unknown as { require?: (m: string) => unknown }).require;
    const electron = req?.("electron") as { shell?: { openPath(p: string): Promise<string> } } | undefined;
    void electron?.shell?.openPath(dir);
  } catch {
    new Notice(dir);
  }
}

/**
 * Markdown 视图里开着的笔记：每次存盘 / 被外面改了，和上一份比一下。
 * Obsidian 的编辑器有没存的改动时收到外部修改会按字符合并，拼坏的内容最后是它存进去的，只有这里看得到。
 * 两个插件都装着时只由表格插件看（enabled 决定），免得重复读文件
 */
export function watchMarkdown(app: App, plugin: Plugin, diag: Diag, enabled: () => boolean): void {
  const last = new Map<string, string>();
  const openPaths = () => {
    const s = new Set<string>();
    for (const l of app.workspace.getLeavesOfType("markdown")) {
      const f = (l.view as MarkdownView).file;
      if (f) s.add(f.path);
    }
    return s;
  };
  const refresh = () => {
    if (!enabled() || !diag.on) {
      last.clear();
      return;
    }
    const open = openPaths();
    for (const p of [...last.keys()]) if (!open.has(p)) last.delete(p);
    for (const p of open) {
      if (last.has(p)) continue;
      const f = app.vault.getAbstractFileByPath(p);
      if (!(f instanceof TFile)) continue;
      last.set(p, "");
      void app.vault.read(f).then((text) => {
        if (last.get(p) === "") last.set(p, text);
      });
    }
  };
  plugin.registerEvent(app.workspace.on("layout-change", refresh));
  plugin.registerEvent(app.workspace.on("file-open", refresh));
  app.workspace.onLayoutReady(refresh);
  plugin.registerEvent(
    app.vault.on("rename", (f, old) => {
      const t = last.get(old);
      if (t === undefined) return;
      last.delete(old);
      last.set(f.path, t);
    }),
  );
  plugin.registerEvent(
    app.vault.on("modify", (f) => {
      if (!(f instanceof TFile) || !last.has(f.path) || !enabled() || !diag.on) return;
      const path = f.path;
      void app.vault.read(f).then((now) => {
        const prev = last.get(path) ?? null;
        last.set(path, now);
        if (prev === now) return;
        diag.change(path, prev === "" ? null : prev, now, originOf(app, diag, path, now));
      });
    }),
  );
}

/** 这份内容是谁写的：两个插件最近记下的写盘里有同样摘要的就是它们；Markdown 编辑器里正是这份就是编辑器存的；都不是就是外部 */
function originOf(app: App, diag: Diag, path: string, text: string): DiagOrigin {
  const h = hashText(text);
  for (const d of [diag, ...peerDiags(app, diag)]) {
    const ev = d
      .events()
      .reverse()
      .find((e) => e.ev === "change" && e.file === path && e.h === h && (e.origin === "mindmap" || e.origin === "table"));
    if (ev) return ev.origin as DiagOrigin;
  }
  for (const l of app.workspace.getLeavesOfType("markdown")) {
    const v = l.view as MarkdownView;
    if (v.file?.path === path && v.editor?.getValue() === text) return "editor";
  }
  return "external";
}

/** 导出诊断包：选要不要笔记全文、要不要隐藏文件名 */
class ExportModal extends Modal {
  private content = true;
  private hide = false;
  constructor(
    app: App,
    private readonly diag: Diag,
  ) {
    super(app);
  }
  onOpen(): void {
    this.setTitle(L("导出诊断包", "Export diagnostics"));
    this.contentEl.createEl("p", {
      text: L(
        "把本机记下的诊断信息合成一个文件（在诊断文件夹的 exports 里），发给开发者排查。里面有插件版本、启用的插件列表、读写事件，以及出过异常的笔记副本。发送前可以自己打开看。",
        "Bundles the diagnostics saved on this computer into one file (in the exports folder) to send to the developer. It contains plugin versions, the list of enabled plugins, read/write events and copies of notes that had a problem. You can open it to check before sending.",
      ),
    });
    new Setting(this.contentEl)
      .setName(L("包含笔记内容", "Include note content"))
      .setDesc(L("出过异常的笔记，变化前后的全文。不带的话只有长度和摘要，能看出是谁改的，但没法重放。", "Full text of affected notes before and after. Without it only lengths and hashes are included: enough to see who changed what, not to replay it."))
      .addToggle((t) => t.setValue(this.content).onChange((v) => (this.content = v)));
    new Setting(this.contentEl)
      .setName(L("隐藏文件名", "Hide file names"))
      .setDesc(L("笔记路径换成一串摘要。", "Replace note paths with hashes."))
      .addToggle((t) => t.setValue(this.hide).onChange((v) => (this.hide = v)));
    new Setting(this.contentEl).addButton((b) =>
      b
        .setButtonText(L("导出并打开文件夹", "Export and open folder"))
        .setCta()
        .onClick(() => {
          const others: DiagEvent[] = peerDiags(this.app, this.diag).flatMap((d) => d.events());
          const p = this.diag.exportBundle({ content: this.content, hideNames: this.hide }, others);
          this.close();
          if (!p) {
            new Notice(L("导出失败", "Export failed"));
            return;
          }
          new Notice(L(`已导出：${p}`, `Exported: ${p}`), 8000);
          openFolder(p.replace(/[\\/][^\\/]+$/, ""));
        }),
    );
  }
  onClose(): void {
    this.contentEl.empty();
  }
}

/** 设置页「诊断」这几行（声明式设置用）；手机上没有 */
export function diagSettingDefinitions(app: App, diag: Diag | null): SettingDefinition[] {
  if (!diag) return [];
  return diagRows(app, diag).map((r) => ({ name: r.name, desc: r.desc, render: (s: Setting) => r.render(s) }));
}

/** 旧版 Obsidian（没有声明式设置）照同样的几行画 */
export function renderDiagSettings(app: App, diag: Diag | null, el: HTMLElement): void {
  if (!diag) return;
  for (const r of diagRows(app, diag)) r.render(new Setting(el).setName(r.name).setDesc(r.desc));
}

function diagRows(app: App, diag: Diag): { name: string; desc: string; render: (s: Setting) => void }[] {
  const day = 24 * 3600 * 1000;
  const untilText = () => {
    const u = diag.config().detailedUntil;
    return u > Date.now() ? L(`开着，${new Date(u).toLocaleDateString()} 自动关闭`, `On until ${new Date(u).toLocaleDateString()}`) : "";
  };
  return [
    {
      name: L("记录异常时的诊断信息", "Keep diagnostics when a note goes wrong"),
      desc: L(
        "在内存里记下最近的读写事件（不含笔记内容）。笔记突然变空、被大量删减或疑似被拼坏时，自动在本机保存变化前后的副本和这些事件，方便恢复和排查。只存在本机 Obsidian 的应用数据目录里，不在库里，不会上传，也不会被 git、网盘同步。",
        "Keeps recent read/write events in memory (no note content). If a note suddenly becomes empty, loses a large part or looks garbled, a copy from before and after plus those events is saved on this computer, so you can recover it and we can find the cause. Stored only in Obsidian's app data folder outside your vault: never uploaded and not touched by git or cloud sync.",
      ),
      render: (s) => {
        s.addToggle((t) =>
          t.setValue(diag.config().blackbox).onChange((v) => {
            diag.setConfig({ blackbox: v });
          }),
        );
      },
    },
    {
      name: L("详细诊断", "Detailed diagnostics"),
      desc: L(`把所有读写事件持续写进本机的记录文件，排查问题时按开发者的要求打开，${DETAILED_DAYS} 天后自动关闭。`, `Writes every read/write event to a log file on this computer. Turn on when the developer asks; it turns itself off after ${DETAILED_DAYS} days.`),
      render: (s) => {
        const info = s.descEl.createDiv({ text: untilText() });
        s.addToggle((t) =>
          t.setValue(diag.detailed()).onChange((v) => {
            diag.setConfig({ detailedUntil: v ? Date.now() + DETAILED_DAYS * day : 0, ...(v ? { blackbox: true } : {}) });
            info.setText(untilText());
          }),
        );
      },
    },
    {
      name: L("副本里保存笔记全文", "Save note text in copies"),
      desc: L("关掉后只记长度和摘要，隐私更好，但出事后没法用副本恢复。", "Off: only lengths and hashes are kept. More private, but the copies can't be used to recover a note."),
      render: (s) => {
        s.addToggle((t) =>
          t.setValue(diag.config().saveContent).onChange((v) => {
            diag.setConfig({ saveContent: v });
          }),
        );
      },
    },
    {
      name: L("诊断记录", "Diagnostics"),
      desc: "",
      render: (s) => {
        const show = () => {
          const st = diag.stats();
          s.setDesc(L(`已保存 ${st.incidents} 份异常副本，最近 ${st.events} 条事件，占用 ${(st.bytes / 1024).toFixed(0)} KB。`, `${st.incidents} saved copies, ${st.events} recent events, ${(st.bytes / 1024).toFixed(0)} KB used.`));
        };
        show();
        s.addButton((b) => b.setButtonText(L("打开文件夹", "Open folder")).onClick(() => openFolder(diag.base)));
        s.addButton((b) => b.setButtonText(L("导出诊断包", "Export")).onClick(() => new ExportModal(app, diag).open()));
        s.addButton((b) => {
          b.buttonEl.addClass("mod-warning");
          b.setButtonText(L("清空", "Clear")).onClick(() => {
            diag.clear();
            show();
          });
        });
      },
    },
  ];
}
