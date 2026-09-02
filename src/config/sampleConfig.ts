import type { StatusCraftConfig } from "../types.js";

/** Used by `statuscraft init` and by the test/demo fixtures. */
export const sampleConfig: StatusCraftConfig = {
  site: {
    name: "Acme",
    description: "Live status for Acme's public APIs and websites.",
    logoText: "Acme Status",
    supportUrl: "https://example.com/support",
  },
  intervalMinutes: 5,
  uptimeWindowDays: 90,
  checks: [
    {
      id: "marketing-site",
      name: "Marketing site",
      group: "Web",
      url: "https://example.com",
      method: "GET",
      timeoutMs: 8000,
      assertions: [
        { kind: "status", expected: [200, 299] },
        { kind: "maxLatencyMs", degradedAboveMs: 800, downAboveMs: 5000 },
      ],
    },
    {
      id: "public-api",
      name: "Public API",
      group: "API",
      url: "https://example.com/api/health",
      method: "GET",
      timeoutMs: 8000,
      assertions: [
        { kind: "status", expected: 200 },
        { kind: "maxLatencyMs", degradedAboveMs: 400, downAboveMs: 3000 },
        { kind: "bodyContains", value: "ok" },
      ],
    },
  ],
};
