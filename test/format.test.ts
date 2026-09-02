import { describe, expect, it } from "vitest";
import { formatDuration, formatPercent, formatTimestamp, statusLabel } from "../src/generator/format.js";

describe("formatPercent", () => {
  it("renders a two-decimal percentage", () => {
    expect(formatPercent(0.9987)).toBe("99.87%");
  });

  it("renders an em dash for null", () => {
    expect(formatPercent(null)).toBe("—");
  });

  it("handles 100% and 0% cleanly", () => {
    expect(formatPercent(1)).toBe("100.00%");
    expect(formatPercent(0)).toBe("0.00%");
  });
});

describe("formatTimestamp", () => {
  it("formats an ISO string as UTC", () => {
    expect(formatTimestamp("2024-01-01T00:05:30.000Z")).toBe("2024-01-01 00:05:30 UTC");
  });

  it("renders 'never' for null", () => {
    expect(formatTimestamp(null)).toBe("never");
  });
});

describe("formatDuration", () => {
  it("renders under a minute for very short spans", () => {
    expect(formatDuration("2024-01-01T00:00:00Z", "2024-01-01T00:00:30Z")).toBe("under a minute");
  });

  it("renders minutes for spans under an hour", () => {
    expect(formatDuration("2024-01-01T00:00:00Z", "2024-01-01T00:45:00Z")).toBe("45 min");
  });

  it("renders hours and minutes", () => {
    expect(formatDuration("2024-01-01T00:00:00Z", "2024-01-01T02:15:00Z")).toBe("2h 15m");
  });

  it("renders whole hours without minutes when exact", () => {
    expect(formatDuration("2024-01-01T00:00:00Z", "2024-01-01T03:00:00Z")).toBe("3h");
  });

  it("renders days and hours for long spans", () => {
    expect(formatDuration("2024-01-01T00:00:00Z", "2024-01-03T05:00:00Z")).toBe("2d 5h");
  });
});

describe("statusLabel", () => {
  it("labels every known status", () => {
    expect(statusLabel("up")).toBe("Operational");
    expect(statusLabel("degraded")).toBe("Degraded");
    expect(statusLabel("down")).toBe("Down");
    expect(statusLabel("unknown")).toBe("No data yet");
  });
});
