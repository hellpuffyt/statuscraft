import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ResultStore } from "../src/store/resultStore.js";
import type { CheckResult } from "../src/types.js";

function makeResult(overrides: Partial<CheckResult> = {}): CheckResult {
  return {
    timestamp: "2024-01-01T00:00:00.000Z",
    checkId: "svc",
    checkName: "Service",
    url: "https://example.com",
    status: "up",
    httpStatus: 200,
    latencyMs: 42,
    error: null,
    assertions: [],
    ...overrides,
  };
}

describe("ResultStore", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "statuscraft-store-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("reports non-existence and reads empty before any append", async () => {
    const store = new ResultStore(join(dir, "results.jsonl"));
    expect(await store.exists()).toBe(false);
    expect(await store.readAll()).toEqual([]);
  });

  it("appends and reads back a single result", async () => {
    const store = new ResultStore(join(dir, "results.jsonl"));
    await store.append(makeResult());
    const all = await store.readAll();
    expect(all).toHaveLength(1);
    expect(all[0]?.checkId).toBe("svc");
  });

  it("appends multiple rows across separate calls and preserves order", async () => {
    const store = new ResultStore(join(dir, "results.jsonl"));
    await store.append(makeResult({ timestamp: "2024-01-01T00:00:00.000Z" }));
    await store.append([
      makeResult({ timestamp: "2024-01-01T00:05:00.000Z" }),
      makeResult({ timestamp: "2024-01-01T00:10:00.000Z" }),
    ]);
    const all = await store.readAll();
    expect(all.map((r) => r.timestamp)).toEqual([
      "2024-01-01T00:00:00.000Z",
      "2024-01-01T00:05:00.000Z",
      "2024-01-01T00:10:00.000Z",
    ]);
  });

  it("creates parent directories on demand", async () => {
    const store = new ResultStore(join(dir, "nested", "deep", "results.jsonl"));
    await store.append(makeResult());
    expect(await store.exists()).toBe(true);
  });

  it("is genuinely append-only: the file never shrinks and each write is one JSON line", async () => {
    const path = join(dir, "results.jsonl");
    const store = new ResultStore(path);
    await store.append(makeResult({ checkId: "a" }));
    const afterFirst = await readFile(path, "utf8");
    await store.append(makeResult({ checkId: "b" }));
    const afterSecond = await readFile(path, "utf8");
    expect(afterSecond.startsWith(afterFirst)).toBe(true);
    expect(afterSecond.trim().split("\n")).toHaveLength(2);
  });

  it("skips corrupt lines instead of failing the whole read", async () => {
    const path = join(dir, "results.jsonl");
    const store = new ResultStore(path);
    await store.append(makeResult({ checkId: "good-1" }));
    const { appendFile } = await import("node:fs/promises");
    await appendFile(path, "{not valid json\n", "utf8");
    await store.append(makeResult({ checkId: "good-2" }));
    const all = await store.readAll();
    expect(all.map((r) => r.checkId)).toEqual(["good-1", "good-2"]);
  });

  it("no-ops on an empty append", async () => {
    const store = new ResultStore(join(dir, "results.jsonl"));
    await store.append([]);
    expect(await store.exists()).toBe(false);
  });
});
