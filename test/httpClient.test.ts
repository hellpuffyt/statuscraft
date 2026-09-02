import { describe, expect, it } from "vitest";
import { runHttpCheck } from "../src/checker/httpClient.js";
import type { FetchLike } from "../src/checker/httpClient.js";

function fakeFetch(
  impl: (url: string) => Promise<{ status: number; headers: Record<string, string>; body: string }>,
): FetchLike {
  return (async (url: string) => {
    const result = await impl(url);
    return {
      status: result.status,
      headers: {
        forEach(cb: (value: string, key: string) => void) {
          for (const [k, v] of Object.entries(result.headers)) cb(v, k);
        },
      },
      text: () => Promise.resolve(result.body),
    };
  }) as unknown as FetchLike;
}

describe("runHttpCheck", () => {
  it("captures status, headers, body, and latency on success", async () => {
    let now = 1000;
    const fetchImpl = fakeFetch(() =>
      Promise.resolve({ status: 200, headers: { "x-test": "1" }, body: "hello" }),
    );
    const result = await runHttpCheck({
      url: "https://example.com",
      fetchImpl,
      now: () => (now += 42),
    });
    expect(result.status).toBe(200);
    expect(result.body).toBe("hello");
    expect(result.headers["x-test"]).toBe("1");
    expect(result.error).toBeNull();
    expect(result.latencyMs).toBeGreaterThan(0);
  });

  it("captures a network error without throwing", async () => {
    const fetchImpl: FetchLike = (() => {
      throw new Error("ECONNREFUSED");
    }) as unknown as FetchLike;
    const result = await runHttpCheck({ url: "https://example.com", fetchImpl });
    expect(result.status).toBeNull();
    expect(result.error).toBe("ECONNREFUSED");
  });

  it("reports a timeout distinctly", async () => {
    const fetchImpl: FetchLike = ((_url: string, init: RequestInit & { signal?: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      })) as unknown as FetchLike;
    const result = await runHttpCheck({ url: "https://example.com", fetchImpl, timeoutMs: 5 });
    expect(result.status).toBeNull();
    expect(result.error).toContain("timed out after 5ms");
  });

  it("defaults to GET and forwards method/headers/body for POST", async () => {
    const seen: { method?: string; body?: unknown } = {};
    const fetchImpl: FetchLike = ((_url: string, init: RequestInit) => {
      seen.method = init.method;
      seen.body = init.body;
      return Promise.resolve({
        status: 200,
        headers: { forEach() {} },
        text: () => Promise.resolve(""),
      });
    }) as unknown as FetchLike;

    await runHttpCheck({ url: "https://example.com", fetchImpl });
    expect(seen.method).toBe("GET");

    await runHttpCheck({ url: "https://example.com", method: "POST", body: "payload", fetchImpl });
    expect(seen.method).toBe("POST");
    expect(seen.body).toBe("payload");
  });
});
