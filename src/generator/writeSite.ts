import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { GeneratedSiteData } from "../types.js";
import { renderPage } from "./renderPage.js";
import { styleCss } from "./assets/style.css.js";
import { themeJs } from "./assets/theme.js.js";

export interface WriteSiteOptions {
  outDir: string;
  data: GeneratedSiteData;
}

/**
 * Writes the generated static site to disk: index.html, its assets, and a
 * data.json snapshot of the exact data the page was rendered from — a
 * convenience for anyone who wants to verify the page against the audit
 * trail rather than take it on faith.
 */
export async function writeSite(options: WriteSiteOptions): Promise<void> {
  const { outDir, data } = options;
  await mkdir(join(outDir, "assets"), { recursive: true });
  await writeFile(join(outDir, "index.html"), renderPage(data), "utf8");
  await writeFile(join(outDir, "assets", "style.css"), styleCss, "utf8");
  await writeFile(join(outDir, "assets", "theme.js"), themeJs, "utf8");
  await writeFile(join(outDir, "data.json"), JSON.stringify(data, null, 2), "utf8");
}
