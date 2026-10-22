import { describe, expect, it } from "vitest";
import { bucketByDay, overallStatus, summarizeService } from "../src/store/aggregate.js";
import type { CheckDefinition, CheckResult, ServiceSummary } from "../src/types.js";

function result(overrides: Partial<CheckResult>): CheckResult {
  return {
    timestamp: "2024-01-01T00:00:00.000Z",
    checkId: "svc",
    checkName: "Service",
    url: "https://example.com",
    status: "up",
    httpStatus: 200,
    latencyMs: 10,
    error: null,
    assertions: [],
    ...overrides,
  };
}

describe("bucketByDay", () => {
  it("emits exactly windowDays buckets even with no data", () => {
    const days = bucketByDay([], 5, new Date("2024-01-10T12:00:00.000Z"));
    expect(days).toHaveLength(5);
    expect(days.every((d) => d.status === "unknown")).toBe(true);
    expect(days[4]?.date).toBe("2024-01-10");
    expect(days[0]?.date).toBe("2024-01-06");
  });

  it("classifies a day as down if any result that day was down", () => {
    const results = [
      result({ timestamp: "2024-01-10T01:00:00.000Z", status: "up" }),
      result({ timestamp: "2024-01-10T02:00:00.000Z", status: "down" }),
    ];
    const days = bucketByDay(results, 1, new Date("2024-01-10T23:00:00.000Z"));
    expect(days[0]?.status).toBe("down");
    expect(days[0]?.totalChecks).toBe(2);
  });

  it("classifies a day as degraded when degraded but no down", () => {
    const results = [
      result({ timestamp: "2024-01-10T01:00:00.000Z", status: "up" }),
      result({ timestamp: "2024-01-10T02:00:00.000Z", status: "degraded" }),
    ];
    const days = bucketByDay(results, 1, new Date("2024-01-10T23:00:00.000Z"));
    expect(days[0]?.status).toBe("degraded");
  });

  it("computes uptimeRatio as up / total", () => {
    const results = [
      result({ timestamp: "2024-01-10T01:00:00.000Z", status: "up" }),
      result({ timestamp: "2024-01-10T02:00:00.000Z", status: "up" }),
      result({ timestamp: "2024-01-10T03:00:00.000Z", status: "down" }),
    ];
    const days = bucketByDay(results, 1, new Date("2024-01-10T23:00:00.000Z"));
    expect(days[0]?.uptimeRatio).toBeCloseTo(2 / 3);
  });

  it("ignores results outside the requested window", () => {
    const results = [result({ timestamp: "2020-01-01T00:00:00.000Z", status: "down" })];
    const days = bucketByDay(results, 3, new Date("2024-01-10T00:00:00.000Z"));
    expect(days.every((d) => d.totalChecks === 0)).toBe(true);
  });
});

describe("summarizeService", () => {
  const check: CheckDefinition = {
    id: "svc",
    name: "Service",
    url: "https://example.com",
    assertions: [],
  };

  it("reports unknown status and null uptime with no history", () => {
    const summary = summarizeService(check, [], 7, new Date("2024-01-10T00:00:00.000Z"));
    expect(summary.currentStatus).toBe("unknown");
    expect(summary.windowUptimeRatio).toBeNull();
    expect(summary.lastCheckedAt).toBeNull();
  });

  it("uses the most recent result (by timestamp, not array order) as current status", () => {
    const results = [
      result({ timestamp: "2024-01-10T10:00:00.000Z", status: "down" }),
      result({ timestamp: "2024-01-09T10:00:00.000Z", status: "up" }),
    ];
    const summary = summarizeService(check, results, 7, new Date("2024-01-10T12:00:00.000Z"));
    expect(summary.currentStatus).toBe("down");
    expect(summary.latencyMs).toBe(10);
  });

  it("computes windowUptimeRatio across the whole window, not just one day", () => {
    const results = [
      result({ timestamp: "2024-01-09T10:00:00.000Z", status: "up" }),
      result({ timestamp: "2024-01-10T10:00:00.000Z", status: "down" }),
    ];
    const summary = summarizeService(check, results, 7, new Date("2024-01-10T12:00:00.000Z"));
    expect(summary.windowUptimeRatio).toBeCloseTo(0.5);
  });
});

describe("overallStatus", () => {
  function svc(currentStatus: ServiceSummary["currentStatus"]): ServiceSummary {
    return {
      checkId: "x",
      name: "x",
      currentStatus,
      stale: false,
      lastCheckedAt: null,
      latencyMs: null,
      days: [],
      windowUptimeRatio: null,
    };
  }

  it("is unknown with no services", () => {
    expect(overallStatus([])).toBe("unknown");
  });

  it("is down if any service is down", () => {
    expect(overallStatus([svc("up"), svc("down"), svc("degraded")])).toBe("down");
  });

  it("is degraded if any service is degraded and none are down", () => {
    expect(overallStatus([svc("up"), svc("degraded")])).toBe("degraded");
  });

  it("is up when every service is up", () => {
    expect(overallStatus([svc("up"), svc("up")])).toBe("up");
  });

  it("is unknown when every service is unknown", () => {
    expect(overallStatus([svc("unknown"), svc("unknown")])).toBe("unknown");
  });

  // Changed during the production-readiness audit: this used to expect "up",
  // which rendered "All systems operational" while a service had no data —
  // the exact green-on-missing-data the README promises never to show.
  it("is unknown (not up) when mixed up/unknown with nothing worse", () => {
    expect(overallStatus([svc("up"), svc("unknown")])).toBe("unknown");
  });
});
