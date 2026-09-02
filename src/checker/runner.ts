import type { CheckDefinition, CheckResult } from "../types.js";
import { evaluateAssertions } from "./assertions.js";
import { runHttpCheck, type FetchLike } from "./httpClient.js";
import { deriveStatus } from "./statusEngine.js";

export interface RunCheckOptions {
  fetchImpl?: FetchLike;
  now?: () => number;
  /** Overrides the wall-clock timestamp recorded on the result; for tests. */
  clock?: () => Date;
}

/** Runs one configured check end to end and produces an audit-trail row. */
export async function runCheck(check: CheckDefinition, options: RunCheckOptions = {}): Promise<CheckResult> {
  const clock = options.clock ?? (() => new Date());
  const response = await runHttpCheck({
    url: check.url,
    method: check.method,
    headers: check.headers,
    body: check.body,
    timeoutMs: check.timeoutMs,
    fetchImpl: options.fetchImpl,
    now: options.now,
  });

  const assertionResults = evaluateAssertions(check.assertions, response);
  const status = deriveStatus(response, check.assertions, assertionResults);

  return {
    timestamp: clock().toISOString(),
    checkId: check.id,
    checkName: check.name,
    group: check.group,
    url: check.url,
    status,
    httpStatus: response.status,
    latencyMs: response.latencyMs,
    error: response.error,
    assertions: assertionResults,
  };
}

/** Runs every configured check. Failures in one check never abort the batch. */
export async function runAllChecks(
  checks: CheckDefinition[],
  options: RunCheckOptions = {},
): Promise<CheckResult[]> {
  return Promise.all(checks.map((check) => runCheck(check, options)));
}
