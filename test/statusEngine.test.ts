import { describe, expect, it } from "vitest";
import { deriveStatus } from "../src/checker/statusEngine.js";
import { evaluateAssertions, type RawResponse } from "../src/checker/assertions.js";
import type { Assertion } from "../src/types.js";

function run(response: RawResponse, assertions: Assertion[]) {
  const results = evaluateAssertions(assertions, response);
  return deriveStatus(response, assertions, results);
}

describe("deriveStatus", () => {
  it("is 'up' when every assertion passes and latency is healthy", () => {
    const status = run({ status: 200, headers: {}, body: "ok", latencyMs: 50, error: null }, [
      { kind: "status", expected: 200 },
      { kind: "maxLatencyMs", degradedAboveMs: 300, downAboveMs: 2000 },
    ]);
    expect(status).toBe("up");
  });

  it("is 'degraded' when only latency crosses the soft threshold", () => {
    const status = run({ status: 200, headers: {}, body: "ok", latencyMs: 500, error: null }, [
      { kind: "status", expected: 200 },
      { kind: "maxLatencyMs", degradedAboveMs: 300, downAboveMs: 2000 },
    ]);
    expect(status).toBe("degraded");
  });

  it("is 'down' when latency crosses the hard threshold", () => {
    const status = run({ status: 200, headers: {}, body: "ok", latencyMs: 3000, error: null }, [
      { kind: "maxLatencyMs", degradedAboveMs: 300, downAboveMs: 2000 },
    ]);
    expect(status).toBe("down");
  });

  it("is 'down' on a network error regardless of assertions", () => {
    const status = run({ status: null, headers: {}, body: "", latencyMs: 8000, error: "timed out" }, [
      { kind: "status", expected: 200 },
    ]);
    expect(status).toBe("down");
  });

  it("is 'down' when a non-latency assertion fails, even if fast", () => {
    const status = run({ status: 500, headers: {}, body: "", latencyMs: 20, error: null }, [
      { kind: "status", expected: 200 },
      { kind: "maxLatencyMs", degradedAboveMs: 300, downAboveMs: 2000 },
    ]);
    expect(status).toBe("down");
  });

  it("degraded latency does not mask as 'up' even when no other assertions exist", () => {
    const status = run({ status: 200, headers: {}, body: "", latencyMs: 400, error: null }, [
      { kind: "maxLatencyMs", degradedAboveMs: 300, downAboveMs: 2000 },
    ]);
    expect(status).toBe("degraded");
  });

  it("is 'up' with no assertions at all and no error", () => {
    const status = run({ status: 200, headers: {}, body: "", latencyMs: 10, error: null }, []);
    expect(status).toBe("up");
  });
});
