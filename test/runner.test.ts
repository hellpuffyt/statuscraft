import { describe, expect, it } from "vitest";
import { runAllChecks, runCheck } from "../src/checker/runner.js";
import type { CheckDefinition } from "../src/types.js";
import type { FetchLike } from "../src/checker/httpClient.js";

function stubFetch(status: number, body: string): FetchLike {
  return (() =>
    Promise.resolve({
      status,
      headers: { forEach() {} },
      text: () => Promise.resolve(body),
    })) as unknown as FetchLike;
}

const baseCheck: CheckDefinition = {
  id: "svc",
  name: "Service",
  url: "https://example.com",
  assertions: [{ kind: "status", expected: 200 }],
};

describe("runCheck", () => {
  it("produces a full audit-trail row on success", async () => {
    const clock = () => new Date("2024-01-01T00:00:00.000Z");
    const result = await runCheck(baseCheck, { fetchImpl: stubFetch(200, "ok"), clock });
    expect(result).toMatchObject({
      timestamp: "2024-01-01T00:00:00.000Z",
      checkId: "svc",
      checkName: "Service",
      status: "up",
      httpStatus: 200,
      error: null,
    });
    expect(result.assertions).toHaveLength(1);
    expect(result.assertions[0]?.pass).toBe(true);
  });

  it("marks the row down when the assertion fails", async () => {
    const result = await runCheck(baseCheck, { fetchImpl: stubFetch(500, "error") });
    expect(result.status).toBe("down");
    expect(result.httpStatus).toBe(500);
  });

  it("preserves the group field when present", async () => {
    const grouped: CheckDefinition = { ...baseCheck, group: "API" };
    const result = await runCheck(grouped, { fetchImpl: stubFetch(200, "ok") });
    expect(result.group).toBe("API");
  });
});

describe("runAllChecks", () => {
  it("runs every check independently and does not let one failure abort the batch", async () => {
    const checks: CheckDefinition[] = [
      { ...baseCheck, id: "a", name: "A" },
      { ...baseCheck, id: "b", name: "B" },
    ];
    const failingThenOk: FetchLike = ((url: string) => {
      if (url.includes("never-matches")) throw new Error("boom");
      return Promise.resolve({ status: 200, headers: { forEach() {} }, text: () => Promise.resolve("ok") });
    }) as unknown as FetchLike;
    const results = await runAllChecks(checks, { fetchImpl: failingThenOk });
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.checkId)).toEqual(["a", "b"]);
  });
});
