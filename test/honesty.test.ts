/**
 * "Refuses to lie" regression suite: the page must never render green
 * ("All systems operational" / "Operational") from missing, stale,
 * future-dated or malformed data, and nothing from the result log or the
 * overlay may inject markup.
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { buildSiteData, staleAfterMs } from "../src/generator/buildSiteData.js";
import { renderPage } from "../src/generator/renderPage.js";
import { ResultStore, isValidResultRow } from "../src/store/resultStore.js";
import { createStaticServer, resolveInside } from "../src/serve.js";
import { formatTimestamp } from "../src/generator/format.js";
import { configSchema } from "../src/config/schema.js";
import type { CheckResult, StatusCraftConfig } from "../src/types.js";

const NOW = new Date("2024-01-10T12:00:00.000Z");
const config: StatusCraftConfig = {
  site: { name: "Acme" },
  intervalMinutes: 5,
  uptimeWindowDays: 3,
  checks: [
    { id: "web", name: "Web", url: "https://example.com", assertions: [] },
    { id: "api", name: "API", url: "https://example.com/api", assertions: [] },
  ],
};

function row(checkId: string, minutesAgo: number, status: CheckResult["status"] = "up"): CheckResult {
  return {
    timestamp: new Date(NOW.getTime() - minutesAgo * 60_000).toISOString(),
    checkId,
    checkName: checkId,
    url: "https://example.com",
    status,
    httpStatus: 200,
    latencyMs: 5,
    error: null,
    assertions: [],
  };
}

function page(results: CheckResult[], cfg: StatusCraftConfig = config) {
  const data = buildSiteData({ config: cfg, results, overlay: { incidents: [] }, now: NOW });
  return { data, html: renderPage(data) };
}

describe("never green on missing data", () => {
  it("all services up and fresh -> operational (the control case)", () => {
    const { data, html } = page([row("web", 1), row("api", 1)]);
    expect(data.overallStatus).toBe("up");
    expect(html).toContain("All systems operational");
  });

  it("one service with no results at all -> not operational", () => {
    const { data, html } = page([row("web", 1)]);
    expect(data.overallStatus).toBe("unknown");
    expect(html).not.toContain("All systems operational");
    expect(html).toContain("Status unknown: some systems have no recent check results");
  });

  it("no results at all -> no-data banner", () => {
    const { data, html } = page([]);
    expect(data.overallStatus).toBe("unknown");
    expect(html).toContain("No check results yet for Acme");
  });
});

describe("never green on stale data", () => {
  it("defaults the staleness limit to three check intervals", () => {
    expect(staleAfterMs(config)).toBe(15 * 60_000);
    expect(staleAfterMs({ ...config, intervalMinutes: undefined })).toBe(15 * 60_000);
    expect(staleAfterMs({ ...config, staleAfterMinutes: 60 })).toBe(60 * 60_000);
  });

  it("a last 'up' older than the limit is unknown/stale, not operational", () => {
    const { data, html } = page([row("web", 1), row("api", 16)]);
    const api = data.services.find((s) => s.checkId === "api");
    expect(api?.currentStatus).toBe("unknown");
    expect(api?.stale).toBe(true);
    expect(api?.lastCheckedAt).toBe(row("api", 16).timestamp);
    expect(data.overallStatus).toBe("unknown");
    expect(html).toContain("No recent data");
    expect(html).not.toContain("All systems operational");
  });

  it("a result exactly at the limit is still current", () => {
    const { data } = page([row("web", 15), row("api", 15)]);
    expect(data.overallStatus).toBe("up");
  });

  it("a checker that stopped weeks ago cannot keep the page green", () => {
    const { data } = page([row("web", 60 * 24 * 20), row("api", 60 * 24 * 20)]);
    expect(data.services.every((s) => s.stale && s.currentStatus === "unknown")).toBe(true);
    expect(data.overallStatus).toBe("unknown");
  });

  it("staleAfterMinutes is accepted by the config schema and must be positive", () => {
    const base = {
      site: { name: "A" },
      checks: [{ id: "a", name: "A", url: "https://e.com", assertions: [{ kind: "status", expected: 200 }] }],
    };
    expect(configSchema.safeParse({ ...base, staleAfterMinutes: 30 }).success).toBe(true);
    expect(configSchema.safeParse({ ...base, staleAfterMinutes: 0 }).success).toBe(false);
  });
});

describe("never green from future-dated or out-of-order rows", () => {
  it("a far-future 'up' row does not override a current 'down'", () => {
    const future = { ...row("api", 0), timestamp: "2099-01-01T00:00:00.000Z" };
    const { data } = page([row("web", 1), row("api", 1, "down"), future]);
    expect(data.services.find((s) => s.checkId === "api")?.currentStatus).toBe("down");
  });

  it("orders by instant, not by string, when offsets differ", () => {
    // 11:58+00:00 is later than 12:50+01:00 (= 11:50Z), though it sorts earlier as a string.
    const later = { ...row("api", 0, "down"), timestamp: "2024-01-10T11:58:00+00:00" };
    const earlier = { ...row("api", 0, "up"), timestamp: "2024-01-10T12:50:00+01:00" };
    const { data } = page([row("web", 1), later, earlier]);
    expect(data.services.find((s) => s.checkId === "api")?.currentStatus).toBe("down");
  });
});

describe("result store rejects rows that are not evidence", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "statuscraft-honesty-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("skips and counts invalid rows instead of letting them set a status", async () => {
    const file = join(dir, "results.jsonl");
    const lines = [
      JSON.stringify(row("api", 1, "down")),
      JSON.stringify({ ...row("api", 0), status: "ok" }),
      JSON.stringify({ ...row("api", 0), timestamp: "yesterday" }),
      JSON.stringify({ ...row("api", 0), checkId: "" }),
      JSON.stringify({ ...row("api", 0), latencyMs: "fast" }),
      JSON.stringify([1, 2]),
      "null",
      '{"timestamp": "2024-01-10T11:59:00Z", "checkId": "api", "stat',
    ];
    await writeFile(file, lines.join("\n") + "\n", "utf8");
    const report = await new ResultStore(file).readAllWithReport();
    expect(report.results).toHaveLength(1);
    expect(report.skipped).toBe(7);
    const { data } = page([row("web", 1), ...report.results]);
    expect(data.services.find((s) => s.checkId === "api")?.currentStatus).toBe("down");
  });

  it("isValidResultRow accepts a real row", () => {
    expect(isValidResultRow(row("api", 1))).toBe(true);
  });
});

describe("no markup injection from data files", () => {
  it("escapes status and severity values even when buildSiteData is fed unvalidated input", () => {
    const evil = '"><script>alert(1)</script>';
    const results = [row("web", 1), { ...row("api", 1), status: evil as CheckResult["status"] }];
    const data = buildSiteData({
      config,
      results,
      overlay: { incidents: [] },
      now: NOW,
    });
    data.incidents.push({
      id: "x",
      checkId: "api",
      checkName: "API",
      severity: evil as "minor",
      startedAt: NOW.toISOString(),
      resolvedAt: null,
      worstStatus: "down",
      updates: [{ timestamp: "not a date", state: "investigating", message: "<b>m</b>" }],
      affectedResultCount: 1,
      title: "<img src=x onerror=alert(1)>",
      postmortem: "<script>x</script>",
    });
    const html = renderPage(data);
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<script>x</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("formatTimestamp does not throw on an invalid date", () => {
    expect(formatTimestamp("not a date")).toBe("invalid date");
  });
});

describe("serve stays inside its directory and binds loopback", () => {
  let base: string;
  let root: string;
  let server: Server;
  let port: number;

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), "statuscraft-serve-"));
    root = join(base, "dist-site");
    await mkdir(root);
    await mkdir(join(base, "dist-site-private"));
    await writeFile(join(root, "index.html"), "public", "utf8");
    await writeFile(join(base, "dist-site-private", "secret.txt"), "private", "utf8");
    server = createStaticServer(root);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = (server.address() as AddressInfo).port;
  });
  afterEach(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    await rm(base, { recursive: true, force: true });
  });

  function rawGet(path: string): Promise<{ status: number; body: string }> {
    return new Promise((resolvePromise, reject) => {
      const req = request({ host: "127.0.0.1", port, path, method: "GET" }, (res) => {
        let body = "";
        res.on("data", (c: Buffer) => (body += c.toString()));
        res.on("end", () => resolvePromise({ status: res.statusCode ?? 0, body }));
      });
      req.on("error", reject);
      req.end();
    });
  }

  it("serves files inside the root", async () => {
    expect(await rawGet("/")).toEqual({ status: 200, body: "public" });
  });

  it("refuses a sibling directory that shares the root's name prefix", async () => {
    const res = await rawGet("/../dist-site-private/secret.txt");
    expect(res.status).toBe(403);
    expect(res.body).not.toContain("private");
  });

  it("refuses plain parent traversal", async () => {
    expect((await rawGet("/../../etc/hosts")).status).toBe(403);
    expect(resolveInside(root, "/../x")).toBeNull();
  });
});
