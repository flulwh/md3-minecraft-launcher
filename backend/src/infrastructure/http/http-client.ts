import { request, Dispatcher } from "undici";
import { Readable } from "node:stream";
import { AppConfig } from "../../config/env.js";

export interface HttpResult<T = unknown> {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: T;
}

const USER_AGENT = "NodeLauncher/0.1.0 (+https://github.com/node-launcher)";
const MAX_REDIRECTS = 5;
/** Cap on JSON response bodies (content-length pre-check) to bound memory. */
const MAX_JSON_BYTES = 50 * 1024 * 1024;

type ResponseData = Awaited<ReturnType<typeof request>>;

export class HttpClient {
  private readonly timeoutMs: number;

  constructor(private readonly config: AppConfig) {
    this.timeoutMs = config.env.HTTP_TIMEOUT_MS;
  }

  /** GET with manual redirect following (undici v7 removed maxRedirections). */
  private async getWithRedirects(
    url: string,
    headers: Record<string, string>,
    signal?: AbortSignal,
    depth = 0,
  ): Promise<ResponseData> {
    const res = await request(url, {
      method: "GET",
      headersTimeout: this.timeoutMs,
      bodyTimeout: 0,
      headers,
      ...(signal !== undefined ? { signal } : {}),
    });
    if (
      depth < MAX_REDIRECTS &&
      res.statusCode >= 301 &&
      res.statusCode <= 308 &&
      typeof res.headers["location"] === "string"
    ) {
      await res.body.dump();
      const next = new URL(res.headers["location"], url).toString();
      return this.getWithRedirects(next, headers, signal, depth + 1);
    }
    return res;
  }

  async getJson<T>(url: string, opts?: { timeoutMs?: number; retries?: number; headers?: Record<string, string> }): Promise<T> {
    const retries = opts?.retries ?? 2;
    let lastError: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      let retryDelayMs: number | null = null;
      try {
        const res = await this.getWithRedirects(url, {
          "user-agent": USER_AGENT,
          accept: "application/json",
          ...opts?.headers,
        });

        // Pre-check content-length so an anomalously large response body is
        // rejected before we buffer it all into memory.
        const contentLength = res.headers["content-length"];
        if (typeof contentLength === "string" && Number(contentLength) > MAX_JSON_BYTES) {
          await res.body.dump();
          throw new Error(`JSON response too large (${contentLength} bytes) for ${url}`);
        }

        // 429 rate-limiting: honour Retry-After when present, otherwise back off.
        if (res.statusCode === 429 && attempt < retries) {
          await res.body.dump();
          const retryAfter = res.headers["retry-after"];
          retryDelayMs =
            typeof retryAfter === "string" && /^\d+$/.test(retryAfter)
              ? Number(retryAfter) * 1000
              : 1000;
          throw new Error(`HTTP 429 for ${url}`);
        }
        if (res.statusCode >= 500 && attempt < retries) {
          await res.body.dump();
          retryDelayMs = 300 * 2 ** attempt;
          throw new Error(`HTTP ${res.statusCode}`);
        }
        if (res.statusCode >= 400) {
          await res.body.dump();
          throw new Error(`HTTP ${res.statusCode} for ${url}`);
        }
        return (await res.body.json()) as T;
      } catch (err) {
        lastError = err;
        if (attempt < retries) {
          await new Promise((r) => setTimeout(r, retryDelayMs ?? 300 * 2 ** attempt));
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  /**
   * Opens a streaming GET with redirect following. Returns a Node Readable
   * wrapping the response body. Destroying the stream cancels the request.
   */
  async openStream(
    url: string,
    opts?: { rangeStart?: number; signal?: AbortSignal; headers?: Record<string, string> },
  ): Promise<{ status: number; acceptsRanges: boolean; stream: Readable; contentLength: number | null }> {
    const headers: Record<string, string> = {
      "user-agent": USER_AGENT,
      ...opts?.headers,
    };
    if (opts?.rangeStart !== undefined && opts.rangeStart > 0) {
      headers["range"] = `bytes=${opts.rangeStart}-`;
    }
    const res = await this.getWithRedirects(url, headers, opts?.signal);
    const contentLengthHeader = res.headers["content-length"];
    const contentLength =
      typeof contentLengthHeader === "string" ? Number(contentLengthHeader) : null;
    const acceptRanges = res.headers["accept-ranges"];
    return {
      status: res.statusCode,
      acceptsRanges: Array.isArray(acceptRanges)
        ? acceptRanges.includes("bytes")
        : acceptRanges === "bytes",
      // undici's `request()` resolves to a BodyReadable (a Node Readable), so it
      // must NOT be wrapped with Readable.fromWeb() — that expects a web stream.
      stream: res.body as unknown as Readable,
      contentLength: Number.isFinite(contentLength) ? contentLength : null,
    };
  }

  async postJson<T>(url: string, body: unknown, headers?: Record<string, string>): Promise<HttpResult<T>> {
    const res = await request(url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json", ...headers },
      body: JSON.stringify(body),
      headersTimeout: this.timeoutMs,
      bodyTimeout: this.timeoutMs,
    });
    const text = await res.body.text();
    let parsed: unknown = undefined;
    try {
      parsed = text.length > 0 ? JSON.parse(text) : undefined;
    } catch {
      parsed = text;
    }
    const flatHeaders: Record<string, string | string[] | undefined> = {};
    for (const [k, v] of Object.entries(res.headers)) flatHeaders[k] = v;
    return { status: res.statusCode, headers: flatHeaders, body: parsed as T };
  }

  async postForm<T>(url: string, form: Record<string, string>): Promise<HttpResult<T>> {
    const encoded = new URLSearchParams(form).toString();
    const res = await request(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: encoded,
      headersTimeout: this.timeoutMs,
      bodyTimeout: this.timeoutMs,
    });
    const text = await res.body.text();
    let parsed: unknown = undefined;
    try {
      parsed = text.length > 0 ? JSON.parse(text) : undefined;
    } catch {
      parsed = text;
    }
    const flatHeaders: Record<string, string | string[] | undefined> = {};
    for (const [k, v] of Object.entries(res.headers)) flatHeaders[k] = v;
    return { status: res.statusCode, headers: flatHeaders, body: parsed as T };
  }
}

export type { Dispatcher };
