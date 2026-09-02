import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeSite } from "../src/generator/writeSite.js";
import type { GeneratedSiteData } from "../src/types.js";

const data: GeneratedSiteData = {
  generatedAt: "2024-01-10T12:00:00.000Z",
  site: { name: "Acme" },
  overallStatus: "up",
  services: [],
  incidents: [],
  uptimeWindowDays: 3,
};

describe("writeSite", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "statuscraft-site-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("writes index.html, assets, and a data.json snapshot", async () => {
    const outDir = join(dir, "site");
    await writeSite({ outDir, data });

    await expect(access(join(outDir, "index.html"))).resolves.toBeUndefined();
    await expect(access(join(outDir, "assets", "style.css"))).resolves.toBeUndefined();
    await expect(access(join(outDir, "assets", "theme.js"))).resolves.toBeUndefined();

    const snapshot = JSON.parse(await readFile(join(outDir, "data.json"), "utf8")) as GeneratedSiteData;
    expect(snapshot.site.name).toBe("Acme");
  });

  it("data.json exactly matches the data that was rendered (auditability)", async () => {
    const outDir = join(dir, "site2");
    await writeSite({ outDir, data });
    const snapshot = JSON.parse(await readFile(join(outDir, "data.json"), "utf8")) as GeneratedSiteData;
    expect(snapshot).toEqual(data);
  });
});
