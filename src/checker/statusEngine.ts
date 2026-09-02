import type { Assertion, AssertionResult, CheckStatus, MaxLatencyAssertion } from "../types.js";
import type { RawResponse } from "./assertions.js";

function isMaxLatency(a: Assertion): a is MaxLatencyAssertion {
  return a.kind === "maxLatencyMs";
}

/**
 * Turns a set of evaluated assertions (plus the raw response) into the
 * single CheckStatus shown for that observation. This is the only place
 * "degraded" gets decided, so the rule is deliberately narrow:
 *
 *  - A hard failure (network error, or any non-latency assertion failing,
 *    or latency past `downAboveMs`) is "down".
 *  - Latency past `degradedAboveMs` but under `downAboveMs`, with every
 *    other assertion passing, is "degraded".
 *  - Everything passing is "up".
 */
export function deriveStatus(
  response: RawResponse,
  assertions: Assertion[],
  results: AssertionResult[],
): CheckStatus {
  if (response.error) return "down";

  const latencyAssertion = assertions.find(isMaxLatency);
  const nonLatencyResults = results.filter((r) => r.assertion.kind !== "maxLatencyMs");
  const hardFailure = nonLatencyResults.some((r) => !r.pass);
  if (hardFailure) return "down";

  if (latencyAssertion) {
    if (response.latencyMs >= latencyAssertion.downAboveMs) return "down";
    if (response.latencyMs >= latencyAssertion.degradedAboveMs) return "degraded";
  }

  return "up";
}
