import type { RawResponse } from "./assertions.js";

export interface FetchLike {
  (
    input: string,
    init: RequestInit & { signal?: AbortSignal },
  ): Promise<{
    status: number;
    headers: { forEach(cb: (value: string, key: string) => void): void };
    text(): Promise<string>;
  }>;
}

export interface RunHttpCheckOptions {
  url: string;
  method?: "GET" | "HEAD" | "POST";
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  /** Injectable for tests; defaults to the global fetch. */
  fetchImpl?: FetchLike;
  now?: () => number;
}

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Performs a single HTTP check and returns the raw observation. Never
 * throws — timeouts and network errors are captured into `error` so the
 * caller can turn them into an audit-trail row unconditionally.
 */
export async function runHttpCheck(options: RunHttpCheckOptions): Promise<RawResponse> {
  const {
    url,
    method = "GET",
    headers,
    body,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    fetchImpl = globalThis.fetch as unknown as FetchLike,
    now = () => Date.now(),
  } = options;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const start = now();

  try {
    const res = await fetchImpl(url, {
      method,
      headers,
      body: method === "POST" ? body : undefined,
      signal: controller.signal,
    });
    const text = await res.text();
    const latencyMs = now() - start;
    const responseHeaders: Record<string, string> = {};
    res.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });
    return {
      status: res.status,
      headers: responseHeaders,
      body: text,
      latencyMs,
      error: null,
    };
  } catch (err) {
    const latencyMs = now() - start;
    const isAbort = err instanceof Error && err.name === "AbortError";
    return {
      status: null,
      headers: {},
      body: "",
      latencyMs,
      error: isAbort ? `timed out after ${timeoutMs}ms` : (err as Error).message,
    };
  } finally {
    clearTimeout(timer);
  }
}
