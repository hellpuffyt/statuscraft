import { describe, expect, it } from "vitest";
import { detectAllIncidents, detectIncidents } from "../src/incidents/detector.js";
import type { CheckDefinition, CheckResult } from "../src/types.js";

const check: CheckDefinition = {
  id: "svc",
  name: "Service",
  url: "https://example.com",
  assertions: [],
};

function result(timestamp: string, status: CheckResult["status"]): CheckResult {
  return {
    timestamp,
    checkId: "svc",
    checkName: "Service",
    url: "https://example.com",
    status,
    httpStatus: status === "down" ? null : 200,
    latencyMs: 10,
    error: null,
    assertions: [],
  };
}

describe("detectIncidents", () => {
  it("produces no incidents from an all-up history", () => {
    const results = [result("2024-01-01T00:00:00Z", "up"), result("2024-01-01T00:05:00Z", "up")];
    expect(detectIncidents(check, results)).toEqual([]);
  });

  it("detects a single resolved incident from one down blip", () => {
    const results = [
      result("2024-01-01T00:00:00Z", "up"),
      result("2024-01-01T00:05:00Z", "down"),
      result("2024-01-01T00:10:00Z", "up"),
    ];
    const incidents = detectIncidents(check, results);
    expect(incidents).toHaveLength(1);
    expect(incidents[0]).toMatchObject({
      checkId: "svc",
      startedAt: "2024-01-01T00:05:00Z",
      resolvedAt: "2024-01-01T00:10:00Z",
      worstStatus: "down",
      affectedResultCount: 1,
    });
  });

  it("leaves an incident open when history ends while still degraded", () => {
    const results = [result("2024-01-01T00:00:00Z", "up"), result("2024-01-01T00:05:00Z", "degraded")];
    const incidents = detectIncidents(check, results);
    expect(incidents).toHaveLength(1);
    expect(incidents[0]?.resolvedAt).toBeNull();
    expect(incidents[0]?.worstStatus).toBe("degraded");
  });

  it("classifies severity as critical for long down runs, major for short ones", () => {
    const shortDown = [
      result("2024-01-01T00:00:00Z", "up"),
      result("2024-01-01T00:05:00Z", "down"),
      result("2024-01-01T00:10:00Z", "up"),
    ];
    expect(detectIncidents(check, shortDown)[0]?.severity).toBe("major");

    const longDown = [
      result("2024-01-01T00:00:00Z", "up"),
      result("2024-01-01T00:05:00Z", "down"),
      result("2024-01-01T00:10:00Z", "down"),
      result("2024-01-01T00:15:00Z", "down"),
      result("2024-01-01T00:20:00Z", "up"),
    ];
    expect(detectIncidents(check, longDown)[0]?.severity).toBe("critical");
  });

  it("classifies a degraded-only run as minor severity", () => {
    const results = [
      result("2024-01-01T00:00:00Z", "up"),
      result("2024-01-01T00:05:00Z", "degraded"),
      result("2024-01-01T00:10:00Z", "degraded"),
      result("2024-01-01T00:15:00Z", "up"),
    ];
    expect(detectIncidents(check, results)[0]?.severity).toBe("minor");
  });

  it("treats mixed degraded+down in one run as worstStatus down", () => {
    const results = [
      result("2024-01-01T00:00:00Z", "up"),
      result("2024-01-01T00:05:00Z", "degraded"),
      result("2024-01-01T00:10:00Z", "down"),
      result("2024-01-01T00:15:00Z", "up"),
    ];
    const incidents = detectIncidents(check, results);
    expect(incidents).toHaveLength(1);
    expect(incidents[0]?.worstStatus).toBe("down");
  });

  it("splits two separate bad runs into two incidents", () => {
    const results = [
      result("2024-01-01T00:00:00Z", "up"),
      result("2024-01-01T00:05:00Z", "down"),
      result("2024-01-01T00:10:00Z", "up"),
      result("2024-01-01T00:15:00Z", "up"),
      result("2024-01-01T00:20:00Z", "down"),
      result("2024-01-01T00:25:00Z", "up"),
    ];
    expect(detectIncidents(check, results)).toHaveLength(2);
  });

  it("sorts input by timestamp regardless of array order", () => {
    const results = [
      result("2024-01-01T00:10:00Z", "up"),
      result("2024-01-01T00:05:00Z", "down"),
      result("2024-01-01T00:00:00Z", "up"),
    ];
    const incidents = detectIncidents(check, results);
    expect(incidents).toHaveLength(1);
    expect(incidents[0]?.startedAt).toBe("2024-01-01T00:05:00Z");
  });

  it("an incident that starts at the beginning of history (no prior up) is still detected", () => {
    const results = [result("2024-01-01T00:00:00Z", "down"), result("2024-01-01T00:05:00Z", "up")];
    const incidents = detectIncidents(check, results);
    expect(incidents).toHaveLength(1);
    expect(incidents[0]?.startedAt).toBe("2024-01-01T00:00:00Z");
  });

  it("includes an investigating update at start and a resolved update at recovery", () => {
    const results = [
      result("2024-01-01T00:00:00Z", "up"),
      result("2024-01-01T00:05:00Z", "down"),
      result("2024-01-01T00:10:00Z", "up"),
    ];
    const [incident] = detectIncidents(check, results);
    expect(incident?.updates.map((u) => u.state)).toEqual(["investigating", "resolved"]);
  });
});

describe("detectAllIncidents", () => {
  it("aggregates incidents across multiple checks, sorted newest-first", () => {
    const checkB: CheckDefinition = { ...check, id: "svc-b", name: "Service B" };
    const map = new Map<string, CheckResult[]>([
      [
        "svc",
        [
          result("2024-01-01T00:00:00Z", "up"),
          result("2024-01-01T00:05:00Z", "down"),
          result("2024-01-01T00:10:00Z", "up"),
        ],
      ],
      [
        "svc-b",
        [
          result("2024-02-01T00:00:00Z", "up"),
          result("2024-02-01T00:05:00Z", "down"),
          result("2024-02-01T00:10:00Z", "up"),
        ],
      ],
    ]);
    const incidents = detectAllIncidents([check, checkB], map);
    expect(incidents).toHaveLength(2);
    expect(incidents[0]?.checkId).toBe("svc-b");
    expect(incidents[1]?.checkId).toBe("svc");
  });

  it("returns an empty array when no checks have any bad results", () => {
    const map = new Map<string, CheckResult[]>([["svc", [result("2024-01-01T00:00:00Z", "up")]]]);
    expect(detectAllIncidents([check], map)).toEqual([]);
  });
});
