import { readFile } from "node:fs/promises";
import type { StatusCraftConfig } from "../types.js";
import { assertUniqueCheckIds, configSchema } from "./schema.js";

export async function loadConfig(filePath: string): Promise<StatusCraftConfig> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (err) {
    throw new Error(`could not read config at "${filePath}": ${(err as Error).message}`);
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    throw new Error(`config at "${filePath}" is not valid JSON: ${(err as Error).message}`);
  }

  const result = configSchema.safeParse(json);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`config at "${filePath}" is invalid:\n${issues}`);
  }

  assertUniqueCheckIds(result.data);
  return result.data;
}
