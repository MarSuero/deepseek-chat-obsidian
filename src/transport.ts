import { requestUrl } from "obsidian";

/**
 * HTTP 传输抽象：Obsidian 渲染进程的 fetch 受 CORS 限制，
 * 而 DSH 服务器不返回 CORS 头，必须走 Obsidian 的 requestUrl（绕过 CORS）。
 */
export interface HttpTransport {
  post(url: string, body: string, timeoutMs: number): Promise<{ status: number; text: string }>;
  get(url: string, timeoutMs: number): Promise<{ status: number }>;
}

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([p, new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms))]);
}

/** 基于 Obsidian requestUrl 的实现（绕过 CORS，推荐）。 */
export function createObsidianTransport(): HttpTransport {
  return {
    async post(url, body, timeoutMs) {
      return withTimeout(
        (async () => {
          try {
            const res = await requestUrl({
              url,
              method: "POST",
              headers: { "content-type": "application/json" },
              body,
              throw: false,
            });
            return { status: res.status, text: res.text };
          } catch (error) {
            console.error("[deepseek-chat] transport post failed:", error);
            return { status: 0, text: "" };
          }
        })(),
        timeoutMs,
        { status: 0, text: "" },
      );
    },
    async get(url, timeoutMs) {
      return withTimeout(
        (async () => {
          try {
            const res = await requestUrl({ url, method: "GET", headers: { accept: "text/html" }, throw: false });
            return { status: res.status };
          } catch {
            return { status: 0 };
          }
        })(),
        timeoutMs,
        { status: 0 },
      );
    },
  };
}

/** 基于原生 fetch 的实现（浏览器环境默认，受 CORS 限制，仅作兜底）。 */
export function createFetchTransport(): HttpTransport {
  return {
    async post(url, body, timeoutMs) {
      return withTimeout(
        (async () => {
          try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeoutMs);
            try {
              const res = await fetch(url, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body,
                signal: controller.signal,
              });
              return { status: res.status, text: await res.text() };
            } finally {
              clearTimeout(timer);
            }
          } catch {
            return { status: 0, text: "" };
          }
        })(),
        timeoutMs,
        { status: 0, text: "" },
      );
    },
    async get(url, timeoutMs) {
      return withTimeout(
        (async () => {
          try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeoutMs);
            try {
              const res = await fetch(url, { method: "GET", headers: { accept: "text/html" }, signal: controller.signal });
              return { status: res.status };
            } finally {
              clearTimeout(timer);
            }
          } catch {
            return { status: 0 };
          }
        })(),
        timeoutMs,
        { status: 0 },
      );
    },
  };
}
