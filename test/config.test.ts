import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config/loadConfig.js";
import { assertUniqueCheckIds, configSchema } from "../src/config/schema.js";
import { sampleConfig } from "../src/config/sampleConfig.js";

describe("configSchema", () => {
  it("accepts the shipped sample config", () => {
    expect(configSchema.safeParse(sampleConfig).success).toBe(true);
  });

  it("rejects a check id with uppercase or spaces", () => {
    const bad = { ...sampleConfig, checks: [{ ...sampleConfig.checks[0], id: "Bad Id" }] };
    expect(configSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a check with zero assertions", () => {
    const bad = { ...sampleConfig, checks: [{ ...sampleConfig.checks[0], assertions: [] }] };
    expect(configSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a non-url check target", () => {
    const bad = { ...sampleConfig, checks: [{ ...sampleConfig.checks[0], url: "not-a-url" }] };
    expect(configSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects an unknown assertion kind", () => {
    const bad = {
      ...sampleConfig,
      checks: [{ ...sampleConfig.checks[0], assertions: [{ kind: "somethingElse" }] }],
    };
    expect(configSchema.safeParse(bad).success).toBe(false);
  });

  it("accepts string request headers and rejects non-string header values", () => {
    const withHeaders = (headers: unknown) => ({
      ...sampleConfig,
      checks: [{ ...sampleConfig.checks[0], headers }],
    });
    expect(configSchema.safeParse(withHeaders({ authorization: "Bearer x" })).success).toBe(true);
    expect(configSchema.safeParse(withHeaders({ "x-retries": 3 })).success).toBe(false);
  });

  it("requires site.name", () => {
    const bad = { ...sampleConfig, site: { description: "no name" } };
    expect(configSchema.safeParse(bad).success).toBe(false);
  });
});

describe("assertUniqueCheckIds", () => {
  it("throws on duplicate ids", () => {
    const config = configSchema.parse(sampleConfig);
    const dup = { ...config, checks: [config.checks[0]!, config.checks[0]!] };
    expect(() => assertUniqueCheckIds(dup)).toThrow(/duplicate check id/);
  });

  it("does not throw when ids are unique", () => {
    const config = configSchema.parse(sampleConfig);
    expect(() => assertUniqueCheckIds(config)).not.toThrow();
  });
});

describe("loadConfig", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "statuscraft-config-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("loads and validates a well-formed config file", async () => {
    const file = join(dir, "statuscraft.config.json");
    await writeFile(file, JSON.stringify(sampleConfig), "utf8");
    const config = await loadConfig(file);
    expect(config.site.name).toBe("Acme");
    expect(config.checks).toHaveLength(2);
  });

  it("throws a readable error for a missing file", async () => {
    await expect(loadConfig(join(dir, "missing.json"))).rejects.toThrow(/could not read config/);
  });

  it("throws a readable error for invalid JSON", async () => {
    const file = join(dir, "bad.json");
    await writeFile(file, "{ this is not json", "utf8");
    await expect(loadConfig(file)).rejects.toThrow(/not valid JSON/);
  });

  it("throws a readable error listing schema violations", async () => {
    const file = join(dir, "invalid-schema.json");
    await writeFile(file, JSON.stringify({ site: {}, checks: [] }), "utf8");
    await expect(loadConfig(file)).rejects.toThrow(/invalid/);
  });

  it("rejects duplicate check ids even if each check is individually valid", async () => {
    const file = join(dir, "dup.json");
    const dupConfig = { ...sampleConfig, checks: [sampleConfig.checks[0]!, sampleConfig.checks[0]!] };
    await writeFile(file, JSON.stringify(dupConfig), "utf8");
    await expect(loadConfig(file)).rejects.toThrow(/duplicate check id/);
  });
});
