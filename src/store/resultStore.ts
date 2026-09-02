import { appendFile, mkdir, readFile, access } from "node:fs/promises";
import { dirname } from "node:path";
import type { CheckResult } from "../types.js";

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
    if (!(await this.exists())) return [];
    const raw = await readFile(this.filePath, "utf8");
    const lines = raw.split("\n").filter((line) => line.trim().length > 0);
    const rows: CheckResult[] = [];
    for (const line of lines) {
      try {
        rows.push(JSON.parse(line) as CheckResult);
      } catch {
        // A corrupt or partially-written line is skipped rather than
        // aborting the whole read — a crash mid-append must never make the
        // rest of the audit trail unreadable.
      }
    }
    return rows;
  }

  get path(): string {
    return this.filePath;
  }
}
