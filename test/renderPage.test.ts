import { describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import { renderPage } from "../src/generator/renderPage.js";
import type { GeneratedSiteData } from "../src/types.js";

function baseData(overrides: Partial<GeneratedSiteData> = {}): GeneratedSiteData {
  return {
    generatedAt: "2024-01-10T12:00:00.000Z",
    site: { name: "Acme", description: "Acme's public status" },
    overallStatus: "up",
    services: [],
    incidents: [],
    uptimeWindowDays: 3,
    ...overrides,
  };
}

describe("renderPage", () => {
  it("renders valid HTML with a theme toggle and the site name in the title", () => {
    const html = renderPage(baseData());
    const dom = new JSDOM(html);
    expect(dom.window.document.title).toBe("Acme Status");
    expect(dom.window.document.getElementById("theme-toggle")).not.toBeNull();
  });

  it("shows the empty state for services when none are configured", () => {
    const html = renderPage(baseData());
    expect(html).toContain("No checks configured yet.");
  });

  it("shows the empty state for incidents when there are none", () => {
    const html = renderPage(baseData());
    expect(html).toContain("No incidents recorded");
  });

  it("renders one .service block per service with the right status class", () => {
    const html = renderPage(
      baseData({
        services: [
          {
            checkId: "web",
            name: "Web",
            currentStatus: "degraded",
            lastCheckedAt: "2024-01-10T11:00:00Z",
            latencyMs: 900,
            windowUptimeRatio: 0.97,
            days: [
              {
                date: "2024-01-08",
                totalChecks: 2,
                upCount: 2,
                degradedCount: 0,
                downCount: 0,
                status: "up",
                uptimeRatio: 1,
              },
              {
                date: "2024-01-09",
                totalChecks: 2,
                upCount: 1,
                degradedCount: 1,
                downCount: 0,
                status: "degraded",
                uptimeRatio: 0.5,
              },
              {
                date: "2024-01-10",
                totalChecks: 0,
                upCount: 0,
                degradedCount: 0,
                downCount: 0,
                status: "unknown",
                uptimeRatio: null,
              },
            ],
          },
        ],
      }),
    );
    const dom = new JSDOM(html);
    const doc = dom.window.document;
    expect(doc.querySelectorAll(".service")).toHaveLength(1);
    expect(doc.querySelector(".badge")?.className).toContain("status-degraded");
    expect(doc.querySelectorAll(".bar")).toHaveLength(3);
    expect(doc.querySelector(".uptime-pct")?.textContent).toBe("97.00%");
  });

  it("escapes untrusted-looking service names to prevent HTML injection", () => {
    const html = renderPage(
      baseData({
        services: [
          {
            checkId: "x",
            name: "<script>alert(1)</script>",
            currentStatus: "up",
            lastCheckedAt: null,
            latencyMs: null,
            windowUptimeRatio: null,
            days: [],
          },
        ],
      }),
    );
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("renders incidents with severity badge, timeline entries, and postmortem when present", () => {
    const html = renderPage(
      baseData({
        overallStatus: "down",
        incidents: [
          {
            id: "web-1",
            checkId: "web",
            checkName: "Web",
            severity: "critical",
            startedAt: "2024-01-10T09:00:00Z",
            resolvedAt: "2024-01-10T09:30:00Z",
            worstStatus: "down",
            updates: [
              { timestamp: "2024-01-10T09:00:00Z", state: "investigating", message: "Started." },
              { timestamp: "2024-01-10T09:30:00Z", state: "resolved", message: "Fixed." },
            ],
            affectedResultCount: 3,
            title: "Full outage",
            postmortem: "Root cause was a bad deploy.\n\nWe rolled it back.",
          },
        ],
      }),
    );
    const dom = new JSDOM(html);
    const doc = dom.window.document;
    expect(doc.querySelectorAll(".incident")).toHaveLength(1);
    expect(doc.querySelector(".severity")?.textContent).toBe("critical");
    expect(doc.querySelectorAll(".timeline li")).toHaveLength(2);
    expect(doc.querySelector(".postmortem")?.textContent).toContain("Root cause was a bad deploy.");
  });

  it("reflects overallStatus in the top banner's class and message", () => {
    const html = renderPage(baseData({ overallStatus: "down" }));
    const dom = new JSDOM(html);
    expect(dom.window.document.querySelector(".banner")?.className).toContain("status-down");
    expect(html).toContain("Some systems are down");
  });

  it("links the stylesheet and theme script as relative assets", () => {
    const html = renderPage(baseData());
    expect(html).toContain('href="./assets/style.css"');
    expect(html).toContain('src="./assets/theme.js"');
  });
});
