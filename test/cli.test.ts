import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm, writeFile, readFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);
const CLI_PATH = join(process.cwd(), "src", "cli.ts");
const TSX_BIN = join(process.cwd(), "node_modules", ".bin", process.platform === "win32" ? "tsx.cmd" : "tsx");

async function runCli(args: string[], cwd: string) {
  const quoted = [CLI_PATH, ...args].map((a) => `"${a}"`).join(" ");
  return execAsync(`"${TSX_BIN}" ${quoted}`, { cwd });
}

describe("statuscraft CLI (end to end against a local HTTP server)", () => {
  let server: Server;
  let baseUrl: string;
  let dir: string;

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === "/slow") {
        setTimeout(() => res.writeHead(200).end("ok"), 50);
        return;
      }
      if (req.url === "/broken") {
        res.writeHead(500).end("nope");
        return;
      }
      res.writeHead(200, { "content-type": "text/plain" }).end("ok");
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (address && typeof address === "object") {
      baseUrl = `http://127.0.0.1:${address.port}`;
    } else {
      throw new Error("failed to start test server");
    }
    dir = await mkdtemp(join(tmpdir(), "statuscraft-cli-"));
  }, 20_000);

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  });

  it("init scaffolds a config file", async () => {
    await runCli(["init"], dir);
    const raw = await readFile(join(dir, "statuscraft.config.json"), "utf8");
    const parsed = JSON.parse(raw) as { site: { name: string } };
    expect(parsed.site.name).toBeTruthy();
  });

  it("init refuses to overwrite without --force", async () => {
    await expect(runCli(["init"], dir)).rejects.toThrow();
  });

  it("check --once appends a real observed result to the store", async () => {
    const config = {
      site: { name: "Test Co" },
      uptimeWindowDays: 3,
      checks: [
        {
          id: "healthy",
          name: "Healthy endpoint",
          url: `${baseUrl}/`,
          assertions: [{ kind: "status", expected: 200 }],
        },
        {
          id: "broken",
          name: "Broken endpoint",
          url: `${baseUrl}/broken`,
          assertions: [{ kind: "status", expected: 200 }],
        },
      ],
    };
    await writeFile(join(dir, "statuscraft.config.json"), JSON.stringify(config), "utf8");
    const { stdout } = await runCli(
      ["check", "--config", "statuscraft.config.json", "--out", "data/results.jsonl", "--once"],
      dir,
    );
    expect(stdout).toContain("ran 2 check(s)");

    const raw = await readFile(join(dir, "data", "results.jsonl"), "utf8");
    const lines = raw
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as { checkId: string; status: string });
    expect(lines.find((l) => l.checkId === "healthy")?.status).toBe("up");
    expect(lines.find((l) => l.checkId === "broken")?.status).toBe("down");
  }, 20_000);

  it("generate builds a static site whose banner reflects the down check", async () => {
    await runCli(
      [
        "generate",
        "--config",
        "statuscraft.config.json",
        "--results",
        "data/results.jsonl",
        "--out-dir",
        "dist-site",
      ],
      dir,
    );
    const html = await readFile(join(dir, "dist-site", "index.html"), "utf8");
    expect(html).toContain("Some systems are down");
    await expect(access(join(dir, "dist-site", "assets", "style.css"))).resolves.toBeUndefined();
  }, 20_000);

  it("status prints the overall derived status", async () => {
    const { stdout } = await runCli(
      ["status", "--config", "statuscraft.config.json", "--results", "data/results.jsonl"],
      dir,
    );
    expect(stdout.trim()).toBe("down");
  }, 20_000);

  it("check --once rejects an invalid config with a non-zero exit", async () => {
    await writeFile(join(dir, "bad.config.json"), JSON.stringify({ site: {}, checks: [] }), "utf8");
    await expect(runCli(["check", "--config", "bad.config.json", "--once"], dir)).rejects.toThrow();
  }, 20_000);
});
