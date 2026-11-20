import { type App, Modal, Setting } from "obsidian";

/** 确认框：ok 是红色的确认按钮（节点表格里把加密格子解密成明文之前问一下） */
export function confirmBox(app: App, message: string, ok: string, cancel: string): Promise<boolean> {
  return new Promise((resolve) => {
    let yes = false;
    const m = new Modal(app);
    m.contentEl.createEl("p", { text: message });
    new Setting(m.contentEl)
      .addButton((b) => b.setButtonText(cancel).onClick(() => m.close()))
      .addButton((b) => {
        b.setButtonText(ok).onClick(() => {
          yes = true;
          m.close();
        });
        // 红色按钮：新版本叫 setDestructive，旧版本只有 setWarning
        const btn = b as unknown as { setDestructive?: () => unknown; setWarning: () => unknown };
        if (btn.setDestructive) btn.setDestructive();
        else btn.setWarning();
      });
    m.onClose = () => resolve(yes);
    m.open();
  });
}
