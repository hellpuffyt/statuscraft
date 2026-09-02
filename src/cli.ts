#!/usr/bin/env node
import { Command } from "commander";
import { access, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createServer } from "node:http";
import { readFile as readFileFs } from "node:fs/promises";
import { extname } from "node:path";
import { loadConfig } from "./config/loadConfig.js";
import { sampleConfig } from "./config/sampleConfig.js";
import { runAllChecks } from "./checker/runner.js";
import { ResultStore } from "./store/resultStore.js";
import { buildSiteData } from "./generator/buildSiteData.js";
import { writeSite } from "./generator/writeSite.js";
import { loadOverlay } from "./incidents/overlay.js";
import { overallStatus } from "./store/aggregate.js";

const program = new Command();

program
  .name("statuscraft")
  .description("A status page generator that refuses to lie: every status comes from real check results.")
  .version("1.0.0");

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

program
  .command("init")
  .description("Scaffold statuscraft.config.json in the current directory")
  .option("-f, --force", "overwrite an existing config file", false)
  .action(async (opts: { force: boolean }) => {
    const target = resolve("statuscraft.config.json");
    if (!opts.force && (await pathExists(target))) {
      console.error(`${target} already exists. Pass --force to overwrite.`);
      process.exitCode = 1;
      return;
    }
    await writeFile(target, JSON.stringify(sampleConfig, null, 2) + "\n", "utf8");
    console.log(`Wrote ${target}`);
    console.log(`Next: statuscraft check --once, then statuscraft generate`);
  });

program
  .command("check")
  .description("Run all configured checks once (or on a loop) and append results to the store")
  .option("-c, --config <path>", "path to statuscraft.config.json", "statuscraft.config.json")
  .option("-o, --out <path>", "path to the append-only result store", "data/results.jsonl")
  .option("--once", "run a single round of checks and exit", false)
  .action(async (opts: { config: string; out: string; once: boolean }) => {
    const config = await loadConfig(resolve(opts.config));
    const store = new ResultStore(resolve(opts.out));

    const runOnce = async () => {
      const results = await runAllChecks(config.checks);
      await store.append(results);
      const summary = results.map(
        (r) => `${r.status.toUpperCase().padEnd(8)} ${r.checkName} (${r.latencyMs}ms)`,
      );
      console.log(`[${new Date().toISOString()}] ran ${results.length} check(s)`);
      for (const line of summary) console.log(`  ${line}`);
    };

    if (opts.once) {
      await runOnce();
      return;
    }

    const intervalMs = (config.intervalMinutes ?? 5) * 60_000;
    console.log(`Running checks every ${config.intervalMinutes ?? 5} minute(s). Ctrl+C to stop.`);
    await runOnce();
    const timer = setInterval(() => {
      runOnce().catch((err) => console.error("check run failed:", err));
    }, intervalMs);
    process.on("SIGINT", () => {
      clearInterval(timer);
      process.exit(0);
    });
  });

program
  .command("generate")
  .description("Generate the static status page from the result store")
  .option("-c, --config <path>", "path to statuscraft.config.json", "statuscraft.config.json")
  .option("-r, --results <path>", "path to the append-only result store", "data/results.jsonl")
  .option("-i, --incidents <path>", "path to the incident overlay JSON", "data/incidents.json")
  .option("-d, --out-dir <path>", "output directory for the generated site", "dist-site")
  .action(async (opts: { config: string; results: string; incidents: string; outDir: string }) => {
    const config = await loadConfig(resolve(opts.config));
    const store = new ResultStore(resolve(opts.results));
    const results = await store.readAll();
    const overlay = await loadOverlay(resolve(opts.incidents));

    const data = buildSiteData({ config, results, overlay });
    await mkdir(resolve(opts.outDir), { recursive: true });
    await writeSite({ outDir: resolve(opts.outDir), data });

    console.log(`Generated ${resolve(opts.outDir)}/index.html`);
    console.log(`Overall status: ${data.overallStatus}`);
    console.log(
      `Services: ${data.services.length}, incidents: ${data.incidents.length}, results read: ${results.length}`,
    );
  });

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

program
  .command("serve")
  .description("Serve a generated static site directory for local preview")
  .option("-d, --dir <path>", "directory to serve", "dist-site")
  .option("-p, --port <port>", "port to listen on", "4321")
  .action(async (opts: { dir: string; port: string }) => {
    const root = resolve(opts.dir);
    if (!(await pathExists(root))) {
      console.error(`${root} does not exist. Run "statuscraft generate" first.`);
      process.exitCode = 1;
      return;
    }
    const server = createServer((req, res) => {
      void (async () => {
        const urlPath = (req.url ?? "/").split("?")[0] as string;
        const relative = urlPath === "/" ? "/index.html" : urlPath;
        const filePath = resolve(root + relative);
        if (!filePath.startsWith(root)) {
          res.writeHead(403).end("Forbidden");
          return;
        }
        try {
          const body = await readFileFs(filePath);
          const type = MIME[extname(filePath)] ?? "application/octet-stream";
          res.writeHead(200, { "Content-Type": type }).end(body);
        } catch {
          res.writeHead(404).end("Not found");
        }
      })();
    });
    const port = Number(opts.port);
    server.listen(port, () => {
      console.log(`Serving ${root} at http://localhost:${port}`);
    });
  });

program
  .command("status")
  .description("Print the current overall status as derived from the result store, then exit")
  .option("-c, --config <path>", "path to statuscraft.config.json", "statuscraft.config.json")
  .option("-r, --results <path>", "path to the append-only result store", "data/results.jsonl")
  .action(async (opts: { config: string; results: string }) => {
    const config = await loadConfig(resolve(opts.config));
    const store = new ResultStore(resolve(opts.results));
    const results = await store.readAll();
    const data = buildSiteData({ config, results, overlay: { incidents: [] } });
    console.log(overallStatus(data.services));
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
