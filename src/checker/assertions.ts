import type { Assertion, AssertionResult } from "../types.js";

export interface RawResponse {
  status: number | null;
  headers: Record<string, string>;
  body: string;
  latencyMs: number;
  error: string | null;
}

function getJsonPath(value: unknown, path: string): unknown {
  const segments = path.split(".").filter(Boolean);
  let current: unknown = value;
  for (const segment of segments) {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current)) {
      const index = Number(segment);
      current = Number.isInteger(index) ? current[index] : undefined;
    } else if (typeof current === "object") {
      current = (current as Record<string, unknown>)[segment];
    } else {
      return undefined;
    }
  }
  return current;
}

/**
 * Evaluates a single assertion against a raw response. Never throws: an
 * assertion that cannot be evaluated (e.g. jsonPath against non-JSON body)
 * simply fails with a descriptive reason, because a status page must never
 * crash when a checked endpoint returns garbage.
 */
export function evaluateAssertion(assertion: Assertion, response: RawResponse): AssertionResult {
  switch (assertion.kind) {
    case "status": {
      if (response.status === null) {
        return { assertion, pass: false, detail: "no response received" };
      }
      const { expected } = assertion;
      if (Array.isArray(expected)) {
        const [min, max] = expected;
        const pass = response.status >= min && response.status <= max;
        return {
          assertion,
          pass,
          detail: `status ${response.status} ${pass ? "within" : "outside"} [${min}, ${max}]`,
        };
      }
      const pass = response.status === expected;
      return { assertion, pass, detail: `status ${response.status}, expected ${expected}` };
    }
    case "maxLatencyMs": {
      const { latencyMs } = response;
      const pass = latencyMs < assertion.downAboveMs;
      return {
        assertion,
        pass,
        detail: `latency ${latencyMs}ms (degraded>${assertion.degradedAboveMs}ms, down>${assertion.downAboveMs}ms)`,
      };
    }
    case "bodyContains": {
      const pass = response.body.includes(assertion.value);
      return { assertion, pass, detail: pass ? "found substring" : `missing "${assertion.value}"` };
    }
    case "bodyNotContains": {
      const pass = !response.body.includes(assertion.value);
      return {
        assertion,
        pass,
        detail: pass ? "substring absent as expected" : `found forbidden "${assertion.value}"`,
      };
    }
    case "bodyMatches": {
      try {
        const re = new RegExp(assertion.pattern, assertion.flags);
        const pass = re.test(response.body);
        return { assertion, pass, detail: pass ? "pattern matched" : "pattern did not match" };
      } catch (err) {
        return { assertion, pass: false, detail: `invalid pattern: ${(err as Error).message}` };
      }
    }
    case "jsonPath": {
      try {
        const parsed: unknown = JSON.parse(response.body);
        const actual = getJsonPath(parsed, assertion.path);
        const pass = actual === assertion.equals;
        return {
          assertion,
          pass,
          detail: `${assertion.path} = ${JSON.stringify(actual)}, expected ${JSON.stringify(assertion.equals)}`,
        };
      } catch {
        return { assertion, pass: false, detail: "response body is not valid JSON" };
      }
    }
    case "headerEquals": {
      const key = Object.keys(response.headers).find(
        (h) => h.toLowerCase() === assertion.header.toLowerCase(),
      );
      const actual = key ? response.headers[key] : undefined;
      const pass = actual === assertion.value;
      return {
        assertion,
        pass,
        detail: `header ${assertion.header} = ${JSON.stringify(actual)}, expected "${assertion.value}"`,
      };
    }
  }
}

export function evaluateAssertions(assertions: Assertion[], response: RawResponse): AssertionResult[] {
  return assertions.map((a) => evaluateAssertion(a, response));
}
