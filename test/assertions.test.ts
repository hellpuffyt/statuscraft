import { describe, expect, it } from "vitest";
import { evaluateAssertion, evaluateAssertions, type RawResponse } from "../src/checker/assertions.js";
import type { Assertion } from "../src/types.js";

function response(overrides: Partial<RawResponse> = {}): RawResponse {
  return {
    status: 200,
    headers: {},
    body: "",
    latencyMs: 50,
    error: null,
    ...overrides,
  };
}

describe("evaluateAssertion: status", () => {
  it("passes on exact match", () => {
    const a: Assertion = { kind: "status", expected: 200 };
    expect(evaluateAssertion(a, response({ status: 200 })).pass).toBe(true);
  });

  it("fails on mismatch", () => {
    const a: Assertion = { kind: "status", expected: 200 };
    expect(evaluateAssertion(a, response({ status: 500 })).pass).toBe(false);
  });

  it("passes within an inclusive range", () => {
    const a: Assertion = { kind: "status", expected: [200, 299] };
    expect(evaluateAssertion(a, response({ status: 204 })).pass).toBe(true);
  });

  it("fails outside a range", () => {
    const a: Assertion = { kind: "status", expected: [200, 299] };
    expect(evaluateAssertion(a, response({ status: 301 })).pass).toBe(false);
  });

  it("fails when there is no response at all", () => {
    const a: Assertion = { kind: "status", expected: 200 };
    expect(evaluateAssertion(a, response({ status: null })).pass).toBe(false);
  });
});

describe("evaluateAssertion: maxLatencyMs", () => {
  const a: Assertion = { kind: "maxLatencyMs", degradedAboveMs: 100, downAboveMs: 500 };

  it("passes under the degraded threshold", () => {
    expect(evaluateAssertion(a, response({ latencyMs: 50 })).pass).toBe(true);
  });

  it("still 'passes' the assertion between thresholds (status derivation handles degraded)", () => {
    expect(evaluateAssertion(a, response({ latencyMs: 200 })).pass).toBe(true);
  });

  it("fails once past downAboveMs", () => {
    expect(evaluateAssertion(a, response({ latencyMs: 600 })).pass).toBe(false);
  });
});

describe("evaluateAssertion: bodyContains / bodyNotContains", () => {
  it("bodyContains passes when substring present", () => {
    const a: Assertion = { kind: "bodyContains", value: "ok" };
    expect(evaluateAssertion(a, response({ body: "status: ok" })).pass).toBe(true);
  });

  it("bodyContains fails when substring missing", () => {
    const a: Assertion = { kind: "bodyContains", value: "ok" };
    expect(evaluateAssertion(a, response({ body: "status: fail" })).pass).toBe(false);
  });

  it("bodyNotContains passes when substring absent", () => {
    const a: Assertion = { kind: "bodyNotContains", value: "error" };
    expect(evaluateAssertion(a, response({ body: "all good" })).pass).toBe(true);
  });

  it("bodyNotContains fails when forbidden substring present", () => {
    const a: Assertion = { kind: "bodyNotContains", value: "error" };
    expect(evaluateAssertion(a, response({ body: "fatal error occurred" })).pass).toBe(false);
  });
});

describe("evaluateAssertion: bodyMatches", () => {
  it("passes when the pattern matches", () => {
    const a: Assertion = { kind: "bodyMatches", pattern: "^\\{.*\\}$" };
    expect(evaluateAssertion(a, response({ body: '{"ok":true}' })).pass).toBe(true);
  });

  it("fails when the pattern does not match", () => {
    const a: Assertion = { kind: "bodyMatches", pattern: "^\\d+$" };
    expect(evaluateAssertion(a, response({ body: "not a number" })).pass).toBe(false);
  });

  it("fails gracefully on an invalid pattern instead of throwing", () => {
    const a: Assertion = { kind: "bodyMatches", pattern: "(" };
    const result = evaluateAssertion(a, response({ body: "anything" }));
    expect(result.pass).toBe(false);
    expect(result.detail).toContain("invalid pattern");
  });
});

describe("evaluateAssertion: jsonPath", () => {
  it("passes when the nested value matches", () => {
    const a: Assertion = { kind: "jsonPath", path: "data.status", equals: "ok" };
    const body = JSON.stringify({ data: { status: "ok" } });
    expect(evaluateAssertion(a, response({ body })).pass).toBe(true);
  });

  it("supports array index segments", () => {
    const a: Assertion = { kind: "jsonPath", path: "items.1.state", equals: "ready" };
    const body = JSON.stringify({ items: [{ state: "pending" }, { state: "ready" }] });
    expect(evaluateAssertion(a, response({ body })).pass).toBe(true);
  });

  it("fails when the value differs", () => {
    const a: Assertion = { kind: "jsonPath", path: "data.status", equals: "ok" };
    const body = JSON.stringify({ data: { status: "fail" } });
    expect(evaluateAssertion(a, response({ body })).pass).toBe(false);
  });

  it("fails gracefully on non-JSON body", () => {
    const a: Assertion = { kind: "jsonPath", path: "data.status", equals: "ok" };
    const result = evaluateAssertion(a, response({ body: "<html>not json</html>" }));
    expect(result.pass).toBe(false);
    expect(result.detail).toContain("not valid JSON");
  });
});

describe("evaluateAssertion: headerEquals", () => {
  it("matches case-insensitively by header name", () => {
    const a: Assertion = { kind: "headerEquals", header: "Content-Type", value: "application/json" };
    const result = evaluateAssertion(a, response({ headers: { "content-type": "application/json" } }));
    expect(result.pass).toBe(true);
  });

  it("fails when the header value differs", () => {
    const a: Assertion = { kind: "headerEquals", header: "content-type", value: "application/json" };
    const result = evaluateAssertion(a, response({ headers: { "content-type": "text/html" } }));
    expect(result.pass).toBe(false);
  });

  it("fails when the header is absent", () => {
    const a: Assertion = { kind: "headerEquals", header: "x-request-id", value: "abc" };
    expect(evaluateAssertion(a, response({ headers: {} })).pass).toBe(false);
  });
});

describe("evaluateAssertions", () => {
  it("evaluates every assertion and preserves order", () => {
    const assertions: Assertion[] = [
      { kind: "status", expected: 200 },
      { kind: "bodyContains", value: "ok" },
    ];
    const results = evaluateAssertions(assertions, response({ body: "ok" }));
    expect(results).toHaveLength(2);
    expect(results[0]?.pass).toBe(true);
    expect(results[1]?.pass).toBe(true);
  });

  it("returns an empty array for no assertions", () => {
    expect(evaluateAssertions([], response())).toEqual([]);
  });
});
