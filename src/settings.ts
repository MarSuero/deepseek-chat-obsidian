import { App, PluginSettingTab, Setting } from "obsidian";
import type DeepSeekChatPlugin from "./main";

export interface DeepSeekChatSettings {
  url: string;
  command: string;
  autoStart: boolean;
  autoStartTimeoutSec: number;
}

export const DEFAULT_SETTINGS: DeepSeekChatSettings = {
  url: "http://127.0.0.1:3080",
  command: "dsh",
  autoStart: true,
  autoStartTimeoutSec: 60,
};

export class DeepSeekChatSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly plugin: DeepSeekChatPlugin,
  ) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("服务器地址")
      .setDesc("DSH web 服务的地址，默认 http://127.0.0.1:3080")
      .addText((t) =>
        t
          .setPlaceholder("http://127.0.0.1:3080")
          .setValue(this.plugin.settings.url)
          .onChange(async (v) => {
            this.plugin.settings.url = v.trim() || "http://127.0.0.1:3080";
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("启动命令")
      .setDesc("用于启动服务器的命令，找不到时自动回退 npx")
      .addText((t) =>
        t
          .setPlaceholder("dsh")
          .setValue(this.plugin.settings.command)
          .onChange(async (v) => {
            this.plugin.settings.command = v.trim() || "dsh";
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("自动启动服务器")
      .setDesc("Obsidian 启动时若 DSH 服务未运行，自动拉起 dsh web")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.autoStart).onChange(async (v) => {
          this.plugin.settings.autoStart = v;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("启动超时（秒）")
      .setDesc("自动启动时等待服务器就绪的最长时间")
      .addSlider((s) =>
        s
          .setLimits(10, 180, 5)
          .setValue(this.plugin.settings.autoStartTimeoutSec)
          .setDynamicTooltip()
          .onChange(async (v) => {
            this.plugin.settings.autoStartTimeoutSec = v;
            await this.plugin.saveSettings();
          }),
      );
  }
}
