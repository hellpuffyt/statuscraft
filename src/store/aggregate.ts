import type { CheckDefinition, CheckResult, DayBucket, ServiceStatus, ServiceSummary } from "../types.js";

function dateKey(iso: string): string {
  return iso.slice(0, 10);
}

function statusForDay(upCount: number, degradedCount: number, downCount: number): ServiceStatus {
  const total = upCount + degradedCount + downCount;
  if (total === 0) return "unknown";
  if (downCount > 0) return "down";
  if (degradedCount > 0) return "degraded";
  return "up";
}

/**
 * Buckets a check's results into UTC calendar days covering
 * [windowEnd - windowDays + 1, windowEnd], always emitting `windowDays`
 * buckets even for days with zero observations (rendered as "unknown" —
 * a gap in the audit trail is shown as a gap, never silently as "up").
 */
export function bucketByDay(results: CheckResult[], windowDays: number, windowEnd: Date): DayBucket[] {
  const byDay = new Map<string, { up: number; degraded: number; down: number }>();
  for (const r of results) {
    const key = dateKey(r.timestamp);
    const bucket = byDay.get(key) ?? { up: 0, degraded: 0, down: 0 };
    if (r.status === "up") bucket.up += 1;
    else if (r.status === "degraded") bucket.degraded += 1;
    else bucket.down += 1;
    byDay.set(key, bucket);
  }

  const days: DayBucket[] = [];
  const end = new Date(Date.UTC(windowEnd.getUTCFullYear(), windowEnd.getUTCMonth(), windowEnd.getUTCDate()));
  for (let i = windowDays - 1; i >= 0; i -= 1) {
    const d = new Date(end);
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    const bucket = byDay.get(key);
    const upCount = bucket?.up ?? 0;
    const degradedCount = bucket?.degraded ?? 0;
    const downCount = bucket?.down ?? 0;
    const totalChecks = upCount + degradedCount + downCount;
    days.push({
      date: key,
      totalChecks,
      upCount,
      degradedCount,
      downCount,
      status: statusForDay(upCount, degradedCount, downCount),
      uptimeRatio: totalChecks > 0 ? upCount / totalChecks : null,
    });
  }
  return days;
}

/** Results timestamped further than this into the future are never used as "current". */
export const MAX_CLOCK_SKEW_MS = 5 * 60_000;

/**
 * Summarizes one check. When `staleAfterMs` is given, a newest result older
 * than that (relative to `windowEnd`) makes the service "unknown" with
 * `stale: true`: the last observation is history, not the current state, so
 * an old "up" must never be rendered as operational.
 */
export function summarizeService(
  check: CheckDefinition,
  results: CheckResult[],
  windowDays: number,
  windowEnd: Date,
  staleAfterMs?: number,
): ServiceSummary {
  const nowMs = windowEnd.getTime();
  const sorted = results
    .filter((r) => Number.isFinite(Date.parse(r.timestamp)))
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  const observed = sorted.filter((r) => Date.parse(r.timestamp) <= nowMs + MAX_CLOCK_SKEW_MS);
  const last = observed.at(-1) ?? null;
  const stale =
    last !== null && staleAfterMs !== undefined && nowMs - Date.parse(last.timestamp) > staleAfterMs;
  const days = bucketByDay(sorted, windowDays, windowEnd);

  const totalUp = days.reduce((sum, d) => sum + d.upCount, 0);
  const totalChecks = days.reduce((sum, d) => sum + d.totalChecks, 0);

  return {
    checkId: check.id,
    name: check.name,
    group: check.group,
    currentStatus: last && !stale ? last.status : "unknown",
    stale,
    lastCheckedAt: last ? last.timestamp : null,
    latencyMs: last ? last.latencyMs : null,
    days,
    windowUptimeRatio: totalChecks > 0 ? totalUp / totalChecks : null,
  };
}

/**
 * Rolls per-service statuses up into one page-level status. "up" requires
 * every service to be up: a service with no (recent) data makes the page
 * "unknown", because the page cannot claim it is operational.
 */
export function overallStatus(services: ServiceSummary[]): ServiceStatus {
  if (services.length === 0) return "unknown";
  const statuses = services.map((s) => s.currentStatus);
  if (statuses.some((s) => s === "down")) return "down";
  if (statuses.some((s) => s === "degraded")) return "degraded";
  if (statuses.some((s) => s === "unknown")) return "unknown";
  return "up";
}
