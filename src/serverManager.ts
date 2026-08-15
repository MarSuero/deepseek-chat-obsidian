import { spawn, type ChildProcess } from "child_process";
import { join } from "path";
import type { HttpTransport } from "./transport";

export interface ServerManagerConfig {
  url: string;
  command: string;
  autoStart: boolean;
  timeoutSec: number;
  http: HttpTransport;
  /** 启动服务器时的工作目录（懒取值，返回 vault 根目录）。 */
  cwd?: () => string | undefined;
  onLog?: (message: string) => void;
}

export interface ServerStatus {
  up: boolean;
  startedByUs: boolean;
  starting: boolean;
  url: string;
  message?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 拼接 shell 命令（Windows 下为带空格的可执行路径加引号）。 */
function shellCommand(file: string, args: string[]): string {
  const quote = (s: string) => (process.platform === "win32" && /\s/.test(s) && !/^".*"$/.test(s) ? `"${s}"` : s);
  return [file, ...args].map(quote).join(" ");
}

function runDetached(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false, stdio: "ignore", windowsHide: true });
    child.once("error", reject);
    child.once("exit", () => resolve());
  });
}

/**
 * DSH Web 服务器生命周期管理：探测、按需自动启动（`dsh web`，回退 npx）、停止（仅限本插件启动的进程）。
 */
export class ServerManager {
  private child: ChildProcess | undefined;
  private startedByUs = false;
  private starting = false;
  private lastStatus: ServerStatus;

  constructor(
    private readonly cfg: ServerManagerConfig,
    private readonly onStatus: (status: ServerStatus) => void,
  ) {
    this.lastStatus = { up: false, startedByUs: false, starting: false, url: cfg.url };
  }

  get status(): ServerStatus {
    return this.lastStatus;
  }

  private setStatus(patch: Partial<ServerStatus>) {
    this.lastStatus = { ...this.lastStatus, ...patch };
    this.onStatus(this.lastStatus);
  }

  /** 探测服务器是否在运行。 */
  async isUp(timeoutMs = 2500): Promise<boolean> {
    const { status } = await this.cfg.http.get(this.cfg.url + "/", timeoutMs);
    return status >= 200 && status < 400;
  }

  /** 确保服务器在运行；必要时按配置自动启动。 */
  async ensure(): Promise<{ up: boolean; message?: string }> {
    if (await this.isUp()) {
      this.setStatus({ up: true, starting: false });
      return { up: true };
    }
    if (!this.cfg.autoStart) {
      const msg = `DSH server is not running (${this.cfg.url}). Run "dsh web" manually.`;
      this.setStatus({ up: false, starting: false, message: msg });
      return { up: false, message: msg };
    }
    if (this.starting) {
      const deadline = Date.now() + this.cfg.timeoutSec * 1000;
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
    const detail = started.detail ?? "unknown";
    const msg = `Cannot start the DSH server: ${detail}`;
    this.setStatus({ up: false, starting: false, message: msg });
    return { up: false, message: msg };
  }

  private async start(): Promise<{ ok: boolean; detail?: string }> {
    const resolved = await this.resolveLauncher();
    if (!resolved.command) {
      const detail = resolved.detail ?? "no launcher found (dsh/npx/npm)";
      this.log(`launcher resolution failed: ${detail}`);
      return { ok: false, detail };
    }
    const { command, args } = resolved;
    this.log(`using launcher: ${command} ${(args ?? []).join(" ")}`);
    this.starting = true;
    this.setStatus({ starting: true, up: false });
    let childExited = false;
    let exitInfo = "";
    try {
      this.child = spawn(shellCommand(command, [...(args ?? []), "web"]), {
        shell: true,
        stdio: "ignore",
        windowsHide: true,
        cwd: this.cfg.cwd?.(),
      });
      this.startedByUs = true;
      this.log(`spawned dsh pid=${this.child.pid ?? "?"} (first npx download may be slow)`);
      this.child.once("exit", (code, signal) => {
        exitInfo = `exit code=${code ?? "null"} signal=${signal ?? "none"}`;
        childExited = true;
        this.log(`child exited: ${exitInfo}`);
        this.child = undefined;
        this.startedByUs = false;
        this.setStatus({ up: false, startedByUs: false, starting: false });
      });
      this.child.once("error", (error) => {
        exitInfo = `spawn error: ${error.message}`;
        childExited = true;
        this.log(`child spawn failed: ${exitInfo}`);
        this.child = undefined;
        this.startedByUs = false;
        this.setStatus({ up: false, startedByUs: false, starting: false });
      });
    } catch (error) {
      this.starting = false;
      this.setStatus({ starting: false });
      const detail = `spawn threw: ${error instanceof Error ? error.message : String(error)}`;
      this.log(detail);
      return { ok: false, detail };
    }

    const deadline = Date.now() + this.cfg.timeoutSec * 1000;
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
  private async resolveLauncher(): Promise<{ command?: string; args?: string[]; detail?: string }> {
    const failures: string[] = [];
    // command 含空格说明配置填错了（应该只填命令名），直接跳过走回退
    const configured = /\s/.test(this.cfg.command)
      ? { ok: false, detail: "command contains spaces" }
      : await this.canRun(this.cfg.command);
    if (configured.ok) {
      this.log(`launcher hit configured command = ${this.cfg.command}`);
      return { command: this.cfg.command, args: [] };
    }
    failures.push(`${this.cfg.command}:${configured.detail}`);
    this.log(`command "${this.cfg.command}" unavailable (${configured.detail}), trying npx fallback`);
    for (const npx of this.npxCandidates()) {
      const r = await this.canRun(npx);
      if (r.ok) {
        this.log(`npx available: ${npx}`);
        return { command: npx, args: ["--yes", "@deepseek-ai/dsh@latest"] };
      }
      failures.push(`${npx}:${r.detail}`);
    }
    for (const npm of this.npmCandidates()) {
      const r = await this.canRun(npm);
      if (r.ok) {
        this.log(`npm available: ${npm}`);
        return { command: npm, args: ["exec", "--yes", "@deepseek-ai/dsh@latest"] };
      }
      failures.push(`${npm}:${r.detail}`);
    }
    return { detail: failures.join("; ") };
  }

  private npxCandidates(): string[] {
    const seen = new Set<string>();
    const candidates: string[] = [];
    const push = (c: string | undefined) => {
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
        process.env.APPDATA ? join(process.env.APPDATA, "npm") : undefined,
        process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "npm") : undefined,
      ];
      for (const base of bases) {
        if (!base) continue;
        push(join(base, "nodejs", "npx.cmd"));
        push(join(base, "npx.cmd"));
      }
      push(join("C:\\Program Files", "nodejs", "npx.cmd"));
      push(join("C:\\Program Files (x86)", "nodejs", "npx.cmd"));
    } else {
      push("npx");
      push("/usr/local/bin/npx");
      push("/opt/homebrew/bin/npx");
    }
    return candidates;
  }

  private npmCandidates(): string[] {
    const seen = new Set<string>();
    const candidates: string[] = [];
    const push = (c: string | undefined) => {
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
        process.env.APPDATA ? join(process.env.APPDATA, "npm") : undefined,
        process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "npm") : undefined,
      ];
      for (const base of bases) {
        if (!base) continue;
        push(join(base, "nodejs", "npm.cmd"));
        push(join(base, "npm.cmd"));
      }
      push(join("C:\\Program Files", "nodejs", "npm.cmd"));
      push(join("C:\\Program Files (x86)", "nodejs", "npm.cmd"));
    } else {
      push("npm");
      push("/usr/local/bin/npm");
      push("/opt/homebrew/bin/npm");
    }
    return candidates;
  }

  private log(message: string) {
    this.cfg.onLog?.(`[server] ${message}`);
  }

  private canRun(command: string): Promise<{ ok: boolean; detail: string }> {
    return new Promise((resolve) => {
      const args = ["--version"];
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          resolve({ ok: false, detail: "timeout(15s)" });
        }
      }, 15_000);
      try {
        const child = spawn(shellCommand(command, args), { shell: true, stdio: "ignore", windowsHide: true });
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
  async stop(): Promise<{ ok: boolean; message?: string }> {
    if (!this.startedByUs || !this.child?.pid) {
      return { ok: false, message: "The current server was not started by this plugin; stop it in the terminal that launched it." };
    }
    const pid = this.child.pid;
    try {
      if (process.platform === "win32") {
        await runDetached("taskkill", ["/pid", String(pid), "/T", "/F"]);
      } else {
        await runDetached("kill", ["-TERM", "-" + pid]);
        await sleep(500);
        await runDetached("kill", ["-KILL", "-" + pid]).catch(() => undefined);
      }
    } catch (error) {
      return { ok: false, message: `Stop failed: ${error instanceof Error ? error.message : String(error)}` };
    }
    this.startedByUs = false;
    this.child = undefined;
    this.setStatus({ up: false, startedByUs: false, starting: false });
    return { ok: true };
  }
}
