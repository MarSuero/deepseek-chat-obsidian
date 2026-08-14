import { ItemView, WorkspaceLeaf } from "obsidian";
import type DeepSeekChatPlugin from "./main";

export const VIEW_TYPE_DEEPSEEK_CHAT = "deepseek-chat-view";

export class DeepSeekChatView extends ItemView {
  private frame: HTMLIFrameElement | null = null;
  /** 是否已经加载了网页（服务就绪后可补加载）。 */
  loaded = false;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly plugin: DeepSeekChatPlugin,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_DEEPSEEK_CHAT;
  }

  getDisplayText(): string {
    return "DeepSeek Chat";
  }

  getIcon(): string {
    return "message-square";
  }

  async onOpen() {
    this.contentEl.empty();
    this.contentEl.addClass("dsh-webview");

    const ok = await this.plugin.ensureServer();
    if (!ok) {
      this.loaded = false;
      this.contentEl.createDiv("dsh-empty", (el) => {
        el.textContent = "DSH 服务未运行，请检查插件设置或手动运行 dsh web";
      });
      return;
    }
    this.loadUrl(this.plugin.settings.url);
  }

  /** 把 iframe 指向指定地址（服务就绪后由插件补调用）。 */
  loadUrl(url: string) {
    if (!this.frame) {
      this.contentEl.empty();
      this.contentEl.addClass("dsh-webview");
      this.frame = this.contentEl.createEl("iframe");
      this.frame.addClass("dsh-frame");
      this.frame.setAttribute("allow", "clipboard-read; clipboard-write");
    }
    this.frame.src = url;
    this.loaded = true;
  }

  async onClose() {
    this.frame = null;
    this.loaded = false;
  }
}
