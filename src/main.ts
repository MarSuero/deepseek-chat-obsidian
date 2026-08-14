import { Notice, Plugin, WorkspaceLeaf } from "obsidian";
import { ServerManager } from "./serverManager";
import { createObsidianTransport } from "./transport";
import { DEFAULT_SETTINGS, DeepSeekChatSettingTab, type DeepSeekChatSettings } from "./settings";
import { DeepSeekChatView, VIEW_TYPE_DEEPSEEK_CHAT } from "./view";

export default class DeepSeekChatPlugin extends Plugin {
  settings!: DeepSeekChatSettings;
  server!: ServerManager;

  async onload() {
    await this.loadSettings();

    const adapter = this.app.vault.adapter as { getBasePath?: () => string };
    const vaultPath = adapter.getBasePath?.() ?? "";
    const http = createObsidianTransport();

    this.server = new ServerManager(
      {
        url: this.settings.url,
        command: this.settings.command,
        autoStart: this.settings.autoStart,
        timeoutSec: this.settings.autoStartTimeoutSec,
        http,
        cwd: () => vaultPath,
        onLog: (message) => console.log("[deepseek-chat]", message),
      },
      (status) => {
        if (status.up) {
          // 服务就绪后，若面板已打开但 iframe 还没加载，补一次
          this.app.workspace.getLeavesOfType(VIEW_TYPE_DEEPSEEK_CHAT).forEach((leaf) => {
            const view = leaf.view;
            if (view instanceof DeepSeekChatView && !view.loaded) {
              void view.loadUrl(this.settings.url);
            }
          });
        }
      },
    );

    this.registerView(VIEW_TYPE_DEEPSEEK_CHAT, (leaf: WorkspaceLeaf) => new DeepSeekChatView(leaf, this));

    this.addRibbonIcon("message-square", "打开 DeepSeek Chat", () => void this.activateView());

    this.addCommand({
      id: "open-deepseek-chat",
      name: "打开 DeepSeek Chat 面板",
      callback: () => void this.activateView(),
    });

    this.addSettingTab(new DeepSeekChatSettingTab(this.app, this));
  }

  /** 确保 DSH 服务在线，返回是否可用。 */
  async ensureServer(): Promise<boolean> {
    const res = await this.server.ensure();
    return res.up;
  }

  async activateView() {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE_DEEPSEEK_CHAT)[0];
    if (!leaf) {
      const rightLeaf = workspace.getRightLeaf(false);
      if (rightLeaf) {
        await rightLeaf.setViewState({ type: VIEW_TYPE_DEEPSEEK_CHAT, active: true });
        leaf = rightLeaf;
      }
    }
    if (leaf) workspace.revealLeaf(leaf);
  }

  onunload() {}

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
