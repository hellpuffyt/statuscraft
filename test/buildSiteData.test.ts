import { describe, expect, it } from "vitest";
import { buildSiteData } from "../src/generator/buildSiteData.js";
import type { CheckResult, StatusCraftConfig } from "../src/types.js";

const config: StatusCraftConfig = {
  site: { name: "Acme" },
  uptimeWindowDays: 3,
  checks: [
    { id: "web", name: "Web", url: "https://example.com", assertions: [] },
    { id: "api", name: "API", url: "https://example.com/api", assertions: [] },
  ],
};

function result(checkId: string, timestamp: string, status: CheckResult["status"]): CheckResult {
  return {
    timestamp,
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

describe("buildSiteData", () => {
  it("produces one ServiceSummary per configured check, even with zero results", () => {
    const data = buildSiteData({ config, results: [], overlay: { incidents: [] } });
    expect(data.services).toHaveLength(2);
    expect(data.services.map((s) => s.checkId)).toEqual(["web", "api"]);
    expect(data.overallStatus).toBe("unknown");
  });

  it("rolls per-service status up into overallStatus", () => {
    const now = new Date("2024-01-10T12:00:00Z");
    const results = [
      result("web", "2024-01-10T10:00:00Z", "up"),
      result("api", "2024-01-10T10:00:00Z", "down"),
    ];
    const data = buildSiteData({ config, results, overlay: { incidents: [] }, now });
    expect(data.overallStatus).toBe("down");
  });

  it("derives incidents from the same results it summarizes services from", () => {
    const now = new Date("2024-01-10T12:00:00Z");
    const results = [
      result("api", "2024-01-10T09:00:00Z", "up"),
      result("api", "2024-01-10T10:00:00Z", "down"),
      result("api", "2024-01-10T11:00:00Z", "up"),
    ];
    const data = buildSiteData({ config, results, overlay: { incidents: [] }, now });
    expect(data.incidents).toHaveLength(1);
    expect(data.incidents[0]?.checkId).toBe("api");
  });

  it("applies the overlay to matching incidents", () => {
    const now = new Date("2024-01-10T12:00:00Z");
    const results = [
      result("api", "2024-01-10T09:00:00Z", "up"),
      result("api", "2024-01-10T10:00:00Z", "down"),
      result("api", "2024-01-10T11:00:00Z", "up"),
    ];
    const data = buildSiteData({
      config,
      results,
      overlay: { incidents: [{ id: "api-2024-01-10T10:00:00Z", title: "API outage: bad deploy" }] },
      now,
    });
    expect(data.incidents[0]?.title).toBe("API outage: bad deploy");
  });

  it("defaults uptimeWindowDays to 90 when not configured", () => {
    const noWindowConfig: StatusCraftConfig = { site: { name: "Acme" }, checks: config.checks };
    const data = buildSiteData({ config: noWindowConfig, results: [], overlay: { incidents: [] } });
    expect(data.uptimeWindowDays).toBe(90);
    expect(data.services[0]?.days).toHaveLength(90);
  });

  it("passes the site metadata through unchanged", () => {
    const data = buildSiteData({ config, results: [], overlay: { incidents: [] } });
    expect(data.site).toEqual(config.site);
  });
});
