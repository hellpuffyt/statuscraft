import { z } from "zod";

const assertionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("status"),
    expected: z.union([z.number().int(), z.tuple([z.number().int(), z.number().int()])]),
  }),
  z.object({
    kind: z.literal("maxLatencyMs"),
    degradedAboveMs: z.number().positive(),
    downAboveMs: z.number().positive(),
  }),
  z.object({ kind: z.literal("bodyContains"), value: z.string().min(1) }),
  z.object({ kind: z.literal("bodyNotContains"), value: z.string().min(1) }),
  z.object({ kind: z.literal("bodyMatches"), pattern: z.string().min(1), flags: z.string().optional() }),
  z.object({
    kind: z.literal("jsonPath"),
    path: z.string().min(1),
    equals: z.union([z.string(), z.number(), z.boolean()]),
  }),
  z.object({ kind: z.literal("headerEquals"), header: z.string().min(1), value: z.string() }),
]);

const checkDefinitionSchema = z.object({
  id: z
    .string()
    .min(1)
    .regex(/^[a-z0-9][a-z0-9-]*$/, "id must be lowercase kebab-case"),
  name: z.string().min(1),
  group: z.string().min(1).optional(),
  url: z.string().url(),
  method: z.enum(["GET", "HEAD", "POST"]).optional(),
  headers: z.record(z.string()).optional(),
  body: z.string().optional(),
  timeoutMs: z.number().positive().optional(),
  assertions: z.array(assertionSchema).min(1),
});

export const configSchema = z.object({
  site: z.object({
    name: z.string().min(1),
    description: z.string().optional(),
    url: z.string().url().optional(),
    logoText: z.string().optional(),
    supportUrl: z.string().url().optional(),
  }),
  intervalMinutes: z.number().positive().optional(),
  checks: z.array(checkDefinitionSchema).min(1),
  uptimeWindowDays: z.number().int().positive().max(365).optional(),
});

export type ParsedConfig = z.infer<typeof configSchema>;

export function assertUniqueCheckIds(config: ParsedConfig): void {
  const seen = new Set<string>();
  for (const check of config.checks) {
    if (seen.has(check.id)) {
      throw new Error(`duplicate check id "${check.id}" — ids must be unique and stable over time`);
    }
    seen.add(check.id);
  }
}
