import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { enrichIncidents, loadOverlay } from "../src/incidents/overlay.js";
import type { DetectedIncident } from "../src/types.js";

function incident(overrides: Partial<DetectedIncident> = {}): DetectedIncident {
  return {
    id: "svc-2024-01-01T00:00:00Z",
    checkId: "svc",
    checkName: "Service",
    severity: "major",
    startedAt: "2024-01-01T00:00:00Z",
    resolvedAt: "2024-01-01T00:10:00Z",
    worstStatus: "down",
    updates: [{ timestamp: "2024-01-01T00:00:00Z", state: "investigating", message: "auto" }],
    affectedResultCount: 1,
    ...overrides,
  };
}

describe("loadOverlay", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "statuscraft-overlay-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns an empty overlay when the file does not exist", async () => {
    const overlay = await loadOverlay(join(dir, "missing.json"));
    expect(overlay.incidents).toEqual([]);
  });

  it("returns an empty overlay on invalid JSON rather than throwing", async () => {
    const file = join(dir, "bad.json");
    await writeFile(file, "{not json", "utf8");
    const overlay = await loadOverlay(file);
    expect(overlay.incidents).toEqual([]);
  });

  it("parses a valid overlay file", async () => {
    const file = join(dir, "incidents.json");
    await writeFile(
      file,
      JSON.stringify({
        incidents: [{ id: "svc-2024-01-01T00:00:00Z", title: "Custom title", postmortem: "It broke." }],
      }),
      "utf8",
    );
    const overlay = await loadOverlay(file);
    expect(overlay.incidents).toHaveLength(1);
    expect(overlay.incidents[0]?.title).toBe("Custom title");
  });
});

describe("enrichIncidents", () => {
  it("generates a default title when no overlay entry exists", () => {
    const [enriched] = enrichIncidents([incident()], { incidents: [] });
    expect(enriched?.title).toBe("Outage: Service");
    expect(enriched?.postmortem).toBeNull();
  });

  it("uses 'Degraded performance' wording for degraded incidents", () => {
    const [enriched] = enrichIncidents([incident({ worstStatus: "degraded" })], { incidents: [] });
    expect(enriched?.title).toBe("Degraded performance: Service");
  });

  it("applies an overlay's title, severity, and postmortem by matching id", () => {
    const [enriched] = enrichIncidents([incident()], {
      incidents: [
        {
          id: "svc-2024-01-01T00:00:00Z",
          title: "Database connection pool exhaustion",
          severity: "critical",
          postmortem: "Root cause: pool size too small.",
        },
      ],
    });
    expect(enriched?.title).toBe("Database connection pool exhaustion");
    expect(enriched?.severity).toBe("critical");
    expect(enriched?.postmortem).toBe("Root cause: pool size too small.");
  });

  it("never applies an overlay entry whose id does not match any detected incident", () => {
    const [enriched] = enrichIncidents([incident()], {
      incidents: [{ id: "does-not-exist", title: "Should not apply" }],
    });
    expect(enriched?.title).toBe("Outage: Service");
  });

  it("keeps the original updates when the overlay supplies none", () => {
    const [enriched] = enrichIncidents([incident()], {
      incidents: [{ id: "svc-2024-01-01T00:00:00Z", title: "Renamed" }],
    });
    expect(enriched?.updates).toHaveLength(1);
    expect(enriched?.updates[0]?.state).toBe("investigating");
  });

  it("overrides updates when the overlay supplies its own", () => {
    const [enriched] = enrichIncidents([incident()], {
      incidents: [
        {
          id: "svc-2024-01-01T00:00:00Z",
          updates: [
            { timestamp: "2024-01-01T00:00:00Z", state: "identified", message: "Root cause found." },
            { timestamp: "2024-01-01T00:10:00Z", state: "resolved", message: "Fixed." },
          ],
        },
      ],
    });
    expect(enriched?.updates).toHaveLength(2);
    expect(enriched?.updates[0]?.state).toBe("identified");
  });
});
