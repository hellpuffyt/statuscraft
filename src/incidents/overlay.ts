import { readFile, access } from "node:fs/promises";
import type { DetectedIncident, EnrichedIncident, IncidentOverlayFile } from "../types.js";

/**
 * Loads the (optional) human-authored overlay: postmortem prose, a nicer
 * title, or a severity override, keyed by the detected incident's id. The
 * overlay can only decorate an incident the checker actually produced — it
 * has no way to invent one — which is what keeps the timeline honest while
 * still letting a human write "root cause: our CDN provider had a regional
 * outage" in their own words.
 */
export async function loadOverlay(filePath: string): Promise<IncidentOverlayFile> {
  try {
    await access(filePath);
  } catch {
    return { incidents: [] };
  }
  const raw = await readFile(filePath, "utf8");
  try {
    const parsed = JSON.parse(raw) as IncidentOverlayFile;
    return { incidents: parsed.incidents ?? [] };
  } catch {
    return { incidents: [] };
  }
}

function defaultTitle(incident: DetectedIncident): string {
  const noun = incident.worstStatus === "down" ? "Outage" : "Degraded performance";
  return `${noun}: ${incident.checkName}`;
}

export function enrichIncidents(
  incidents: DetectedIncident[],
  overlay: IncidentOverlayFile,
): EnrichedIncident[] {
  const byId = new Map(overlay.incidents.map((entry) => [entry.id, entry]));
  return incidents.map((incident) => {
    const entry = byId.get(incident.id);
    return {
      ...incident,
      severity: entry?.severity ?? incident.severity,
      title: entry?.title ?? defaultTitle(incident),
      postmortem: entry?.postmortem ?? null,
      updates: entry?.updates?.length ? entry.updates : incident.updates,
    };
  });
}
