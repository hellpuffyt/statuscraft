import type { CheckResult, GeneratedSiteData, StatusCraftConfig } from "../types.js";
import { overallStatus, summarizeService } from "../store/aggregate.js";
import { detectAllIncidents } from "../incidents/detector.js";
import { enrichIncidents } from "../incidents/overlay.js";
import type { IncidentOverlayFile } from "../types.js";

export interface BuildSiteDataOptions {
  config: StatusCraftConfig;
  results: CheckResult[];
  overlay: IncidentOverlayFile;
  now?: Date;
}

const DEFAULT_WINDOW_DAYS = 90;
const DEFAULT_INTERVAL_MINUTES = 5;

/** Staleness limit: explicit `staleAfterMinutes`, else three check intervals. */
export function staleAfterMs(config: StatusCraftConfig): number {
  const minutes = config.staleAfterMinutes ?? 3 * (config.intervalMinutes ?? DEFAULT_INTERVAL_MINUTES);
  return minutes * 60_000;
}

/** Pure function: config + the full result history -> everything the page needs. */
export function buildSiteData(options: BuildSiteDataOptions): GeneratedSiteData {
  const { config, results, overlay } = options;
  const now = options.now ?? new Date();
  const windowDays = config.uptimeWindowDays ?? DEFAULT_WINDOW_DAYS;

  const resultsByCheckId = new Map<string, CheckResult[]>();
  for (const result of results) {
    const bucket = resultsByCheckId.get(result.checkId);
    if (bucket) bucket.push(result);
    else resultsByCheckId.set(result.checkId, [result]);
  }

  const services = config.checks.map((check) =>
    summarizeService(check, resultsByCheckId.get(check.id) ?? [], windowDays, now, staleAfterMs(config)),
  );

  const detected = detectAllIncidents(config.checks, resultsByCheckId);
  const incidents = enrichIncidents(detected, overlay);

  return {
    generatedAt: now.toISOString(),
    site: config.site,
    overallStatus: overallStatus(services),
    services,
    incidents,
    uptimeWindowDays: windowDays,
  };
}
