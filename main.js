"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => DeepSeekChatPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian4 = require("obsidian");

// src/serverManager.ts
var import_child_process = require("child_process");
var import_path = require("path");
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function shellCommand(file, args) {
  const quote = (s) => process.platform === "win32" && /\s/.test(s) && !/^".*"$/.test(s) ? `"${s}"` : s;
  return [file, ...args].map(quote).join(" ");
}
function runDetached(command, args) {
  return new Promise((resolve, reject) => {
    const child = (0, import_child_process.spawn)(command, args, { shell: false, stdio: "ignore", windowsHide: true });
    child.once("error", reject);
    child.once("exit", () => resolve());
  });
}
var ServerManager = class {
  constructor(cfg, onStatus) {
    this.cfg = cfg;
    this.onStatus = onStatus;
    this.startedByUs = false;
    this.starting = false;
    this.lastStatus = { up: false, startedByUs: false, starting: false, url: cfg.url };
  }
  get status() {
    return this.lastStatus;
  }
  setStatus(patch) {
    this.lastStatus = { ...this.lastStatus, ...patch };
    this.onStatus(this.lastStatus);
  }
  /** 探测服务器是否在运行。 */
  async isUp(timeoutMs = 2500) {
    const { status } = await this.cfg.http.get(this.cfg.url + "/", timeoutMs);
    return status >= 200 && status < 400;
  }
  /** 确保服务器在运行；必要时按配置自动启动。 */
  async ensure() {
    var _a;
    if (await this.isUp()) {
      this.setStatus({ up: true, starting: false });
      return { up: true };
    }
    if (!this.cfg.autoStart) {
      const msg2 = `DSH server is not running (${this.cfg.url}). Run "dsh web" manually.`;
      this.setStatus({ up: false, starting: false, message: msg2 });
      return { up: false, message: msg2 };
    }
    if (this.starting) {
      const deadline = Date.now() + this.cfg.timeoutSec * 1e3;
      while (Date.now() < deadline) {
        if (await this.isUp(800)) {
          this.setStatus({ up: true, starting: false });
          return { up: true };
        }
        await sleep(400);
      }
      return { up: false, message: `Waiting for the DSH server timed out (${this.cfg.url})` };
    }
    const started = await this.start();
    if (started.ok) {
      this.setStatus({ up: true, starting: false, startedByUs: true });
      return { up: true };
    }
    const detail = (_a = started.detail) != null ? _a : "unknown";
    const msg = `Cannot start the DSH server: ${detail}`;
    this.setStatus({ up: false, starting: false, message: msg });
    return { up: false, message: msg };
  }
  async start() {
    var _a, _b, _c, _d;
    const resolved = await this.resolveLauncher();
    if (!resolved.launcher) {
      const detail2 = (_a = resolved.detail) != null ? _a : "no launcher found (dsh/npx/npm)";
      this.log(`launcher resolution failed: ${detail2}`);
      return { ok: false, detail: detail2 };
    }
    const launcher = resolved.launcher;
    this.log(`using launcher: ${launcher}`);
    this.starting = true;
    this.setStatus({ starting: true, up: false });
    let childExited = false;
    let exitInfo = "";
    try {
      this.child = (0, import_child_process.spawn)(shellCommand(launcher, ["web"]), {
        shell: true,
        stdio: "ignore",
        windowsHide: true,
        cwd: (_c = (_b = this.cfg).cwd) == null ? void 0 : _c.call(_b)
      });
      this.startedByUs = true;
      this.log(`spawned dsh pid=${(_d = this.child.pid) != null ? _d : "?"} (first npx download may be slow)`);
      this.child.once("exit", (code, signal) => {
        exitInfo = `exit code=${code != null ? code : "null"} signal=${signal != null ? signal : "none"}`;
        childExited = true;
        this.log(`child exited: ${exitInfo}`);
        this.child = void 0;
        this.startedByUs = false;
        this.setStatus({ up: false, startedByUs: false, starting: false });
      });
      this.child.once("error", (error) => {
        exitInfo = `spawn error: ${error.message}`;
        childExited = true;
        this.log(`child spawn failed: ${exitInfo}`);
        this.child = void 0;
        this.startedByUs = false;
        this.setStatus({ up: false, startedByUs: false, starting: false });
      });
    } catch (error) {
      this.starting = false;
      this.setStatus({ starting: false });
      const detail2 = `spawn threw: ${error instanceof Error ? error.message : String(error)}`;
      this.log(detail2);
      return { ok: false, detail: detail2 };
    }
    const deadline = Date.now() + this.cfg.timeoutSec * 1e3;
    while (Date.now() < deadline) {
      if (await this.isUp(800)) {
        this.log("server ready");
        return { ok: true };
      }
      if (childExited) {
        this.log(`child exited before ready (${exitInfo})`);
        break;
      }
      await sleep(500);
    }
    this.starting = false;
    const detail = `DSH server not ready within ${this.cfg.timeoutSec}s (${exitInfo || "no exit info"})`;
    this.setStatus({ starting: false, up: false, message: detail });
    return { ok: false, detail };
  }
  /** 找到可用的启动命令：dsh → npx → npm exec 回退。 */
  async resolveLauncher() {
    const failures = [];
    const configured = await this.canRun(this.cfg.command);
    if (configured.ok) {
      this.log(`launcher hit configured command = ${this.cfg.command}`);
      return { launcher: this.cfg.command };
    }
    failures.push(`${this.cfg.command}:${configured.detail}`);
    this.log(`command "${this.cfg.command}" unavailable (${configured.detail}), trying npx fallback`);
    for (const npx of this.npxCandidates()) {
      const r = await this.canRun(npx);
      if (r.ok) {
        this.log(`npx available: ${npx}`);
        return { launcher: `${npx} --yes @deepseek-ai/dsh@latest` };
      }
      failures.push(`${npx}:${r.detail}`);
    }
    for (const npm of this.npmCandidates()) {
      const r = await this.canRun(npm);
      if (r.ok) {
        this.log(`npm available: ${npm}`);
        return { launcher: `${npm} exec --yes @deepseek-ai/dsh@latest` };
      }
      failures.push(`${npm}:${r.detail}`);
    }
    return { detail: failures.join("; ") };
  }
  npxCandidates() {
    const seen = /* @__PURE__ */ new Set();
    const candidates = [];
    const push = (c) => {
      if (c && !seen.has(c)) {
        seen.add(c);
        candidates.push(c);
      }
    };
    if (process.platform === "win32") {
      push("npx.cmd");
      push("npx");
      const bases = [
        process.env.ProgramFiles,
        process.env["ProgramFiles(x86)"],
        process.env.APPDATA ? (0, import_path.join)(process.env.APPDATA, "npm") : void 0,
        process.env.LOCALAPPDATA ? (0, import_path.join)(process.env.LOCALAPPDATA, "npm") : void 0
      ];
      for (const base of bases) {
        if (!base) continue;
        push((0, import_path.join)(base, "nodejs", "npx.cmd"));
        push((0, import_path.join)(base, "npx.cmd"));
      }
      push((0, import_path.join)("C:\\Program Files", "nodejs", "npx.cmd"));
      push((0, import_path.join)("C:\\Program Files (x86)", "nodejs", "npx.cmd"));
    } else {
      push("npx");
      push("/usr/local/bin/npx");
      push("/opt/homebrew/bin/npx");
    }
    return candidates;
  }
  npmCandidates() {
    const seen = /* @__PURE__ */ new Set();
    const candidates = [];
    const push = (c) => {
      if (c && !seen.has(c)) {
        seen.add(c);
        candidates.push(c);
      }
    };
    if (process.platform === "win32") {
      push("npm.cmd");
      push("npm");
      const bases = [
        process.env.ProgramFiles,
        process.env["ProgramFiles(x86)"],
        process.env.APPDATA ? (0, import_path.join)(process.env.APPDATA, "npm") : void 0,
        process.env.LOCALAPPDATA ? (0, import_path.join)(process.env.LOCALAPPDATA, "npm") : void 0
      ];
      for (const base of bases) {
        if (!base) continue;
        push((0, import_path.join)(base, "nodejs", "npm.cmd"));
        push((0, import_path.join)(base, "npm.cmd"));
      }
      push((0, import_path.join)("C:\\Program Files", "nodejs", "npm.cmd"));
      push((0, import_path.join)("C:\\Program Files (x86)", "nodejs", "npm.cmd"));
    } else {
      push("npm");
      push("/usr/local/bin/npm");
      push("/opt/homebrew/bin/npm");
    }
    return candidates;
  }
  log(message) {
    var _a, _b;
    (_b = (_a = this.cfg).onLog) == null ? void 0 : _b.call(_a, `[server] ${message}`);
  }
  canRun(command) {
    return new Promise((resolve) => {
      const args = ["--version"];
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          resolve({ ok: false, detail: "timeout(15s)" });
        }
      }, 15e3);
      try {
        const child = (0, import_child_process.spawn)(shellCommand(command, args), { shell: true, stdio: "ignore", windowsHide: true });
        child.once("error", (error) => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            resolve({ ok: false, detail: `error ${error.message}` });
          }
        });
        child.once("exit", (code) => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            resolve({ ok: code === 0, detail: `exit ${code}` });
          }
        });
      } catch (error) {
        settled = true;
        clearTimeout(timer);
        resolve({ ok: false, detail: `throw ${error instanceof Error ? error.message : String(error)}` });
      }
    });
  }
  /** 停止由本插件启动的服务器（杀进程树）。 */
  async stop() {
    var _a;
    if (!this.startedByUs || !((_a = this.child) == null ? void 0 : _a.pid)) {
      return { ok: false, message: "The current server was not started by this plugin; stop it in the terminal that launched it." };
    }
    const pid = this.child.pid;
    try {
      if (process.platform === "win32") {
        await runDetached("taskkill", ["/pid", String(pid), "/T", "/F"]);
      } else {
        await runDetached("kill", ["-TERM", "-" + pid]);
        await sleep(500);
        await runDetached("kill", ["-KILL", "-" + pid]).catch(() => void 0);
      }
    } catch (error) {
      return { ok: false, message: `Stop failed: ${error instanceof Error ? error.message : String(error)}` };
    }
    this.startedByUs = false;
    this.child = void 0;
    this.setStatus({ up: false, startedByUs: false, starting: false });
    return { ok: true };
  }
};

// src/transport.ts
var import_obsidian = require("obsidian");
function withTimeout(p, ms, fallback) {
  return Promise.race([p, new Promise((resolve) => setTimeout(() => resolve(fallback), ms))]);
}
function createObsidianTransport() {
  return {
    async post(url, body, timeoutMs) {
      return withTimeout(
        (async () => {
          try {
            const res = await (0, import_obsidian.requestUrl)({
              url,
              method: "POST",
              headers: { "content-type": "application/json" },
              body,
              throw: false
            });
            return { status: res.status, text: res.text };
          } catch (error) {
            console.error("[deepseek-chat] transport post failed:", error);
            return { status: 0, text: "" };
          }
        })(),
        timeoutMs,
        { status: 0, text: "" }
      );
    },
    async get(url, timeoutMs) {
      return withTimeout(
        (async () => {
          try {
            const res = await (0, import_obsidian.requestUrl)({ url, method: "GET", headers: { accept: "text/html" }, throw: false });
            return { status: res.status };
          } catch (e) {
            return { status: 0 };
          }
        })(),
        timeoutMs,
        { status: 0 }
      );
    }
  };
}

// src/settings.ts
var import_obsidian2 = require("obsidian");
var DEFAULT_SETTINGS = {
  url: "http://127.0.0.1:3080",
  command: "dsh",
  autoStart: true,
  autoStartTimeoutSec: 60
};
var DeepSeekChatSettingTab = class extends import_obsidian2.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    new import_obsidian2.Setting(containerEl).setName("\u670D\u52A1\u5668\u5730\u5740").setDesc("DSH web \u670D\u52A1\u7684\u5730\u5740\uFF0C\u9ED8\u8BA4 http://127.0.0.1:3080").addText(
      (t) => t.setPlaceholder("http://127.0.0.1:3080").setValue(this.plugin.settings.url).onChange(async (v) => {
        this.plugin.settings.url = v.trim() || "http://127.0.0.1:3080";
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("\u542F\u52A8\u547D\u4EE4").setDesc("\u7528\u4E8E\u542F\u52A8\u670D\u52A1\u5668\u7684\u547D\u4EE4\uFF0C\u627E\u4E0D\u5230\u65F6\u81EA\u52A8\u56DE\u9000 npx").addText(
      (t) => t.setPlaceholder("dsh").setValue(this.plugin.settings.command).onChange(async (v) => {
        this.plugin.settings.command = v.trim() || "dsh";
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("\u81EA\u52A8\u542F\u52A8\u670D\u52A1\u5668").setDesc("Obsidian \u542F\u52A8\u65F6\u82E5 DSH \u670D\u52A1\u672A\u8FD0\u884C\uFF0C\u81EA\u52A8\u62C9\u8D77 dsh web").addToggle(
      (t) => t.setValue(this.plugin.settings.autoStart).onChange(async (v) => {
        this.plugin.settings.autoStart = v;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("\u542F\u52A8\u8D85\u65F6\uFF08\u79D2\uFF09").setDesc("\u81EA\u52A8\u542F\u52A8\u65F6\u7B49\u5F85\u670D\u52A1\u5668\u5C31\u7EEA\u7684\u6700\u957F\u65F6\u95F4").addSlider(
      (s) => s.setLimits(10, 180, 5).setValue(this.plugin.settings.autoStartTimeoutSec).setDynamicTooltip().onChange(async (v) => {
        this.plugin.settings.autoStartTimeoutSec = v;
        await this.plugin.saveSettings();
      })
    );
  }
};

// src/view.ts
var import_obsidian3 = require("obsidian");
var VIEW_TYPE_DEEPSEEK_CHAT = "deepseek-chat-view";
var DeepSeekChatView = class extends import_obsidian3.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.frame = null;
    /** 是否已经加载了网页（服务就绪后可补加载）。 */
    this.loaded = false;
  }
  getViewType() {
    return VIEW_TYPE_DEEPSEEK_CHAT;
  }
  getDisplayText() {
    return "DeepSeek Chat";
  }
  getIcon() {
    return "message-square";
  }
  async onOpen() {
    this.contentEl.empty();
    this.contentEl.addClass("dsh-webview");
    const ok = await this.plugin.ensureServer();
    if (!ok) {
      this.loaded = false;
      this.contentEl.createDiv("dsh-empty", (el) => {
        el.textContent = "DSH \u670D\u52A1\u672A\u8FD0\u884C\uFF0C\u8BF7\u68C0\u67E5\u63D2\u4EF6\u8BBE\u7F6E\u6216\u624B\u52A8\u8FD0\u884C dsh web";
      });
      return;
    }
    this.loadUrl(this.plugin.settings.url);
  }
  /** 把 iframe 指向指定地址（服务就绪后由插件补调用）。 */
  loadUrl(url) {
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
};

// src/main.ts
var DeepSeekChatPlugin = class extends import_obsidian4.Plugin {
  async onload() {
    var _a, _b;
    await this.loadSettings();
    const adapter = this.app.vault.adapter;
    const vaultPath = (_b = (_a = adapter.getBasePath) == null ? void 0 : _a.call(adapter)) != null ? _b : "";
    const http = createObsidianTransport();
    this.server = new ServerManager(
      {
        url: this.settings.url,
        command: this.settings.command,
        autoStart: this.settings.autoStart,
        timeoutSec: this.settings.autoStartTimeoutSec,
        http,
        cwd: () => vaultPath,
        onLog: (message) => console.log("[deepseek-chat]", message)
      },
      (status) => {
        if (status.up) {
          this.app.workspace.getLeavesOfType(VIEW_TYPE_DEEPSEEK_CHAT).forEach((leaf) => {
            const view = leaf.view;
            if (view instanceof DeepSeekChatView && !view.loaded) {
              void view.loadUrl(this.settings.url);
            }
          });
        }
      }
    );
    this.registerView(VIEW_TYPE_DEEPSEEK_CHAT, (leaf) => new DeepSeekChatView(leaf, this));
    this.addRibbonIcon("message-square", "\u6253\u5F00 DeepSeek Chat", () => void this.activateView());
    this.addCommand({
      id: "open-deepseek-chat",
      name: "\u6253\u5F00 DeepSeek Chat \u9762\u677F",
      callback: () => void this.activateView()
    });
    this.addSettingTab(new DeepSeekChatSettingTab(this.app, this));
  }
  /** 确保 DSH 服务在线，返回是否可用。 */
  async ensureServer() {
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
  onunload() {
  }
  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
};
