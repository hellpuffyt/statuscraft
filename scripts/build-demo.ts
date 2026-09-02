/**
 * Builds the fixture data and static site shipped under examples/demo/. This
 * is deterministic (seeded PRNG) so `npm run demo:build` always produces the
 * same bytes — useful for reviewing generator changes in a diff.
 */
import { rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { CheckDefinition, CheckResult, StatusCraftConfig } from "../src/types.js";
import { ResultStore } from "../src/store/resultStore.js";
import { buildSiteData } from "../src/generator/buildSiteData.js";
import { writeSite } from "../src/generator/writeSite.js";
import { loadOverlay } from "../src/incidents/overlay.js";

// Small deterministic PRNG (mulberry32) so the demo is reproducible.
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(42);

const config: StatusCraftConfig = {
  site: {
    name: "Northwind",
    description: "Live status for Northwind's storefront, API, and payments.",
    logoText: "Northwind Status",
    supportUrl: "https://example.com/support",
  },
  intervalMinutes: 5,
  uptimeWindowDays: 90,
  checks: [
    {
      id: "storefront",
      name: "Storefront",
      group: "Web",
      url: "https://shop.example.com",
      assertions: [
        { kind: "status", expected: [200, 299] },
        { kind: "maxLatencyMs", degradedAboveMs: 700, downAboveMs: 4000 },
      ],
    },
    {
      id: "checkout-api",
      name: "Checkout API",
      group: "API",
      url: "https://shop.example.com/api/checkout",
      assertions: [
        { kind: "status", expected: 200 },
        { kind: "maxLatencyMs", degradedAboveMs: 350, downAboveMs: 2500 },
        { kind: "bodyContains", value: "ok" },
      ],
    },
    {
      id: "payments-webhook",
      name: "Payments webhook receiver",
      group: "API",
      url: "https://shop.example.com/webhooks/payments",
      assertions: [{ kind: "status", expected: [200, 204] }],
    },
    {
      id: "cdn",
      name: "Asset CDN",
      group: "Infra",
      url: "https://cdn.example.com/health",
      assertions: [{ kind: "status", expected: 200 }],
    },
  ] satisfies CheckDefinition[],
};

const WINDOW_DAYS = 90;
const INTERVAL_MINUTES = 20;
const NOW = new Date("2024-06-15T12:00:00.000Z");

interface Incident {
  checkId: string;
  startHoursAgo: number;
  durationHours: number;
  status: "degraded" | "down";
}

// Hand-placed incidents so the demo tells a believable story:
const incidents: Incident[] = [
  { checkId: "checkout-api", startHoursAgo: 24 * 58, durationHours: 2, status: "down" }, // ~58 days ago, resolved outage
  { checkId: "storefront", startHoursAgo: 24 * 31, durationHours: 6, status: "degraded" }, // ~31 days ago, degraded perf
  { checkId: "payments-webhook", startHoursAgo: 24 * 9 + 3, durationHours: 1.5, status: "down" }, // ~9 days ago, brief outage
  { checkId: "checkout-api", startHoursAgo: 6, durationHours: 3, status: "degraded" }, // ongoing degraded, ends 3h ago
];

function statusAt(checkId: string, timestamp: Date): "up" | "degraded" | "down" {
  const hoursAgo = (NOW.getTime() - timestamp.getTime()) / 3_600_000;
  for (const inc of incidents) {
    if (inc.checkId !== checkId) continue;
    if (hoursAgo <= inc.startHoursAgo && hoursAgo >= inc.startHoursAgo - inc.durationHours) {
      return inc.status;
    }
  }
  return "up";
}

function baseLatency(checkId: string): number {
  switch (checkId) {
    case "storefront":
      return 180;
    case "checkout-api":
      return 120;
    case "payments-webhook":
      return 90;
    default:
      return 40;
  }
}

function buildResults(check: CheckDefinition): CheckResult[] {
  const results: CheckResult[] = [];
  const totalTicks = Math.floor((WINDOW_DAYS * 24 * 60) / INTERVAL_MINUTES);
  for (let i = totalTicks; i >= 0; i -= 1) {
    const timestamp = new Date(NOW.getTime() - i * INTERVAL_MINUTES * 60_000);
    const status = statusAt(check.id, timestamp);
    const jitter = (rand() - 0.5) * 40;
    const latencyMs =
      status === "down"
        ? 3000 + Math.round(rand() * 1500)
        : status === "degraded"
          ? baseLatency(check.id) + 900 + Math.round(rand() * 400)
          : Math.max(10, Math.round(baseLatency(check.id) + jitter));
    results.push({
      timestamp: timestamp.toISOString(),
      checkId: check.id,
      checkName: check.name,
      group: check.group,
      url: check.url,
      status,
      httpStatus: status === "down" ? (rand() < 0.5 ? 503 : null) : 200,
      latencyMs,
      error: status === "down" && rand() < 0.5 ? "connect ECONNREFUSED" : null,
      assertions: [],
    });
  }
  return results;
}

async function main() {
  const outDir = join(process.cwd(), "examples", "demo");
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  const resultsPath = join(outDir, "results.jsonl");
  const store = new ResultStore(resultsPath);
  for (const check of config.checks) {
    await store.append(buildResults(check));
  }

  const overlayPath = join(outDir, "incidents.json");
  await mkdir(outDir, { recursive: true });
  const { writeFile } = await import("node:fs/promises");
  await writeFile(
    overlayPath,
    JSON.stringify(
      {
        incidents: [
          {
            id: "checkout-api-" + new Date(NOW.getTime() - 24 * 58 * 3_600_000).toISOString(),
            title: "Checkout API outage: database failover",
            severity: "critical",
            postmortem:
              "Summary: Checkout requests began failing for all customers after our primary database's automatic failover picked a replica that had not fully caught up on replication.\n\nRoot cause: A misconfigured replication lag alert meant on-call was not paged when the replica fell behind. When the primary failed a routine health check, the orchestrator promoted the lagging replica, which briefly rejected writes with schema mismatches.\n\nRemediation: We reconfigured the replication lag alert threshold from 60s to 10s, added a pre-promotion freshness check to the failover orchestrator, and added this exact scenario to our quarterly failover drill.",
          },
          {
            id: "payments-webhook-" + new Date(NOW.getTime() - (24 * 9 + 3) * 3_600_000).toISOString(),
            title: "Payments webhook receiver: brief 5xx spike",
            severity: "major",
            postmortem:
              "Summary: The webhook receiver returned 503s for roughly 90 minutes during a scheduled dependency upgrade.\n\nRoot cause: The upgrade rolled out with a health check that passed before the process had finished warming its connection pool, so early traffic was rejected.\n\nRemediation: The health check now waits for the connection pool to report ready before advertising itself as healthy.",
          },
        ],
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );

  const allResults = await store.readAll();

  const overlay = await loadOverlay(overlayPath);
  const data = buildSiteData({ config, results: allResults, overlay, now: NOW });
  await writeSite({ outDir: join(outDir, "site"), data });

  console.log(`Demo written to ${outDir}`);
  console.log(`Overall status: ${data.overallStatus}, incidents: ${data.incidents.length}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
