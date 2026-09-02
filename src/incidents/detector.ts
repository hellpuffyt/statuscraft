import type { CheckDefinition, CheckResult, DetectedIncident, IncidentSeverity } from "../types.js";

function severityFor(worstStatus: "degraded" | "down", runLength: number): IncidentSeverity {
  if (worstStatus === "down") return runLength >= 3 ? "critical" : "major";
  return "minor";
}

/**
 * Derives incidents purely from consecutive runs of non-"up" results for a
 * single check, in chronological order. This is the only place incidents
 * come from: there is no API to declare one out of thin air. A run starts
 * on the first non-"up" result after an "up" (or the beginning of history)
 * and ends on the first "up" result after it, or stays open if history ends
 * while still degraded/down.
 */
export function detectIncidents(check: CheckDefinition, results: CheckResult[]): DetectedIncident[] {
  const sorted = [...results].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const incidents: DetectedIncident[] = [];

  let runStart: CheckResult | null = null;
  let runResults: CheckResult[] = [];

  const closeRun = (endedAt: string | null) => {
    if (!runStart) return;
    const worst = runResults.some((r) => r.status === "down") ? "down" : "degraded";
    incidents.push({
      id: `${check.id}-${runStart.timestamp}`,
      checkId: check.id,
      checkName: check.name,
      group: check.group,
      severity: severityFor(worst, runResults.length),
      startedAt: runStart.timestamp,
      resolvedAt: endedAt,
      worstStatus: worst,
      updates: [
        {
          timestamp: runStart.timestamp,
          state: "investigating",
          message: `Automated check "${check.name}" started reporting ${worst}.`,
        },
        ...(endedAt
          ? [
              {
                timestamp: endedAt,
                state: "resolved" as const,
                message: `Automated check "${check.name}" recovered to up.`,
              },
            ]
          : []),
      ],
      affectedResultCount: runResults.length,
    });
    runStart = null;
    runResults = [];
  };

  for (const result of sorted) {
    if (result.status === "up") {
      closeRun(result.timestamp);
    } else {
      if (!runStart) runStart = result;
      runResults.push(result);
    }
  }
  // History ended mid-incident: leave it open.
  closeRun(null);

  return incidents;
}

export function detectAllIncidents(
  checks: CheckDefinition[],
  resultsByCheckId: Map<string, CheckResult[]>,
): DetectedIncident[] {
  const all: DetectedIncident[] = [];
  for (const check of checks) {
    const results = resultsByCheckId.get(check.id) ?? [];
    all.push(...detectIncidents(check, results));
  }
  return all.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}
