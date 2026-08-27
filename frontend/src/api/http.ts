import type { ApiErrorEnvelope } from "./types";

export const API_BASE: string =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "http://127.0.0.1:8787";

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
    readonly httpStatus?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(API_BASE + path, {
      ...init,
      headers: {
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...(init?.headers ?? {}),
      },
    });
  } catch {
    throw new ApiError("NETWORK_ERROR", "无法连接后端服务，请确认后端已启动");
  }

  const body = (await res.json().catch(() => null)) as
    | { success: true; data: T }
    | ApiErrorEnvelope
    | null;

  if (!res.ok || body === null || body.success === false) {
    if (body !== null && body.success === false) {
      throw new ApiError(body.error.code, body.error.message, body.error.details, res.status);
    }
    throw new ApiError("REQUEST_ERROR", `请求失败 (${res.status})`, undefined, res.status);
  }
  return body.data;
}

export const http = {
  get: <T>(path: string): Promise<T> => request<T>(path),
  post: <T>(path: string, body?: unknown): Promise<T> =>
    request<T>(path, {
      method: "POST",
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  put: <T>(path: string, body?: unknown): Promise<T> =>
    request<T>(path, {
      method: "PUT",
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  patch: <T>(path: string, body?: unknown): Promise<T> =>
    request<T>(path, {
      method: "PATCH",
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  del: <T>(path: string): Promise<T> => request<T>(path, { method: "DELETE" }),
};
