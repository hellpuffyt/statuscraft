/**
 * Core domain types for statuscraft.
 *
 * The guiding rule of this whole project: nothing on the generated page is
 * ever hand-set. Every status shown is derived, at generation time, from
 * rows in the append-only result store. If you want a component to say
 * "degraded", a check has to actually observe something degraded.
 */

/** The three states a single check observation can resolve to. */
export type CheckStatus = "up" | "degraded" | "down";

/** The state shown for a whole service, one notch richer than a check result. */
export type ServiceStatus = "up" | "degraded" | "down" | "unknown";

/** The kind of assertion that can be attached to an HTTP check. */
export type AssertionKind =
  | "status"
  | "maxLatencyMs"
  | "bodyContains"
  | "bodyNotContains"
  | "bodyMatches"
  | "jsonPath"
  | "headerEquals";

export interface StatusAssertion {
  kind: "status";
  /** Accepts a single code, or an inclusive [min, max] range. */
  expected: number | [number, number];
}

export interface MaxLatencyAssertion {
  kind: "maxLatencyMs";
  /** Requests slower than this are marked degraded, not down. */
  degradedAboveMs: number;
  /** Requests slower than this (or that time out) are marked down. */
  downAboveMs: number;
}

export interface BodyContainsAssertion {
  kind: "bodyContains";
  value: string;
}

export interface BodyNotContainsAssertion {
  kind: "bodyNotContains";
  value: string;
}

export interface BodyMatchesAssertion {
  kind: "bodyMatches";
  /** Source of a RegExp, e.g. "\\\"status\\\":\\\"ok\\\"". */
  pattern: string;
  flags?: string;
}

export interface JsonPathAssertion {
  kind: "jsonPath";
  /** Dot path, e.g. "data.status". Arrays supported via numeric segments. */
  path: string;
  equals: string | number | boolean;
}

export interface HeaderEqualsAssertion {
  kind: "headerEquals";
  header: string;
  value: string;
}

export type Assertion =
  | StatusAssertion
  | MaxLatencyAssertion
  | BodyContainsAssertion
  | BodyNotContainsAssertion
  | BodyMatchesAssertion
  | JsonPathAssertion
  | HeaderEqualsAssertion;

export interface CheckDefinition {
  /** Stable identifier used as the audit-trail key. Never rename in place. */
  id: string;
  /** Human-facing name shown on the status page. */
  name: string;
  /** Optional grouping label, e.g. "API", "Web", "Infra". */
  group?: string;
  url: string;
  method?: "GET" | "HEAD" | "POST";
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  assertions: Assertion[];
}

export interface StatusCraftConfig {
  site: {
    name: string;
    description?: string;
    /** e.g. "https://status.example.com" — used for absolute links only. */
    url?: string;
    logoText?: string;
    supportUrl?: string;
  };
  /** Minutes between checks when running the daemon. */
  intervalMinutes?: number;
  checks: CheckDefinition[];
  /** How many days of history to render as uptime bars. */
  uptimeWindowDays?: number;
}

/** The result of evaluating one assertion against a raw HTTP response. */
export interface AssertionResult {
  assertion: Assertion;
  pass: boolean;
  detail: string;
}

/**
 * One row of the append-only result store. This is the audit trail: every
 * field here is either observed directly from the network call or computed
 * deterministically from it. Nothing here is ever mutated after being
 * appended — corrections happen by appending a newer row, never by editing
 * an old one.
 */
export interface CheckResult {
  /** ISO-8601 timestamp of when the check ran. */
  timestamp: string;
  checkId: string;
  checkName: string;
  group?: string;
  url: string;
  status: CheckStatus;
  httpStatus: number | null;
  latencyMs: number;
  error: string | null;
  assertions: AssertionResult[];
}

/** Severity of a declared incident. */
export type IncidentSeverity = "minor" | "major" | "critical";

export type IncidentState = "investigating" | "identified" | "monitoring" | "resolved";

export interface IncidentUpdate {
  timestamp: string;
  state: IncidentState;
  message: string;
}

/**
 * Incidents are derived automatically from runs of degraded/down results
 * (see src/incidents/detector.ts), then optionally enriched by a
 * human-authored overlay file (postmortem text, custom title/severity) that
 * is merged on top at generation time. The overlay can add narrative, but it
 * can never fabricate an incident that the check history did not produce.
 */
export interface DetectedIncident {
  id: string;
  checkId: string;
  checkName: string;
  group?: string;
  severity: IncidentSeverity;
  startedAt: string;
  resolvedAt: string | null;
  /** Worst status observed during the incident window. */
  worstStatus: Exclude<CheckStatus, "up">;
  updates: IncidentUpdate[];
  affectedResultCount: number;
}

export interface IncidentOverlayEntry {
  id: string;
  title?: string;
  severity?: IncidentSeverity;
  postmortem?: string;
  updates?: IncidentUpdate[];
}

export interface IncidentOverlayFile {
  incidents: IncidentOverlayEntry[];
}

export interface EnrichedIncident extends DetectedIncident {
  title: string;
  postmortem: string | null;
}

/** Per-day uptime summary used to draw the heartbeat bars. */
export interface DayBucket {
  /** yyyy-mm-dd, UTC. */
  date: string;
  totalChecks: number;
  upCount: number;
  degradedCount: number;
  downCount: number;
  status: ServiceStatus;
  /** Fraction of checks that were "up", 0..1. Null when there was no data. */
  uptimeRatio: number | null;
}

export interface ServiceSummary {
  checkId: string;
  name: string;
  group?: string;
  currentStatus: ServiceStatus;
  lastCheckedAt: string | null;
  latencyMs: number | null;
  days: DayBucket[];
  /** Uptime ratio over the whole rendered window, 0..1, null if no data. */
  windowUptimeRatio: number | null;
}

export interface GeneratedSiteData {
  generatedAt: string;
  site: StatusCraftConfig["site"];
  overallStatus: ServiceStatus;
  services: ServiceSummary[];
  incidents: EnrichedIncident[];
  uptimeWindowDays: number;
}
