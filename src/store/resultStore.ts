import { appendFile, mkdir, readFile, access } from "node:fs/promises";
import { dirname } from "node:path";
import type { CheckResult } from "../types.js";

const STATUSES = new Set(["up", "degraded", "down"]);

/**
 * A row is only usable as evidence if it has the fields the generator relies
 * on: a parseable timestamp, a check id, and one of the three statuses.
 * Anything else (a hand-edited "ok", a missing timestamp, a non-object) is
 * rejected rather than guessed at.
 */
export function isValidResultRow(row: unknown): row is CheckResult {
  if (typeof row !== "object" || row === null || Array.isArray(row)) return false;
  const r = row as Record<string, unknown>;
  return (
    typeof r["timestamp"] === "string" &&
    Number.isFinite(Date.parse(r["timestamp"])) &&
    typeof r["checkId"] === "string" &&
    r["checkId"].length > 0 &&
    typeof r["status"] === "string" &&
    STATUSES.has(r["status"]) &&
    typeof r["latencyMs"] === "number" &&
    Number.isFinite(r["latencyMs"])
  );
}

export interface ReadReport {
  results: CheckResult[];
  /** Lines that were not valid JSON or not a valid result row. */
  skipped: number;
}

/**
 * The result store is a single append-only JSONL file: one JSON object per
 * line, one line per check observation, oldest first. It is never rewritten
 * in place — appending is the only write operation this module exposes —
 * which is what makes it a credible audit trail: you can `git diff` it, ship
 * it to cold storage, or replay it, and nothing upstream can quietly edit
 * history.
 */
export class ResultStore {
  constructor(private readonly filePath: string) {}

  async append(results: CheckResult | CheckResult[]): Promise<void> {
    const rows = Array.isArray(results) ? results : [results];
    if (rows.length === 0) return;
    await mkdir(dirname(this.filePath), { recursive: true });
    const lines = rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
    await appendFile(this.filePath, lines, "utf8");
  }

  async exists(): Promise<boolean> {
    try {
      await access(this.filePath);
      return true;
    } catch {
      return false;
    }
  }

  /** Reads and parses every row. Blank lines and trailing newlines are ignored. */
  async readAll(): Promise<CheckResult[]> {
    return (await this.readAllWithReport()).results;
  }

  /**
   * Like readAll, but also reports how many non-blank lines were skipped.
   * A corrupt or partially-written line is skipped rather than aborting the
   * whole read (a crash mid-append must never make the rest of the audit
   * trail unreadable), and so is a well-formed JSON line that is not a valid
   * result row — it must not be able to set a service's status.
   */
  async readAllWithReport(): Promise<ReadReport> {
    if (!(await this.exists())) return { results: [], skipped: 0 };
    const raw = await readFile(this.filePath, "utf8");
    const lines = raw.split("\n").filter((line) => line.trim().length > 0);
    const rows: CheckResult[] = [];
    let skipped = 0;
    for (const line of lines) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        skipped += 1;
        continue;
      }
      if (isValidResultRow(parsed)) rows.push(parsed);
      else skipped += 1;
    }
    return { results: rows, skipped };
  }

  get path(): string {
    return this.filePath;
  }
}
