import { createHash } from "node:crypto";

import { z } from "zod";

export const RedactionResultSchema = z
  .object({
    redactedText: z.string(),
    redactionCount: z.number().int().nonnegative(),
    fingerprints: z.array(z.string()).default([]),
  })
  .strict();

export type RedactionResult = z.infer<typeof RedactionResultSchema>;

const SECRET_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  {
    name: "github-token",
    pattern: /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g,
  },
  {
    name: "bearer-token",
    pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}\b/g,
  },
  {
    name: "generic-api-key",
    pattern: /\b(?:api[_-]?key|token|secret|password)\s*=\s*['"]?[^\s'"]{8,}/gi,
  },
  {
    name: "private-key",
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  },
];

const SENSITIVE_ENV_KEY_PATTERN =
  /(TOKEN|SECRET|PASSWORD|PASS|API_KEY|ACCESS_KEY|PRIVATE_KEY|CREDENTIAL|AUTH)/i;

export function redactText(input: string): RedactionResult {
  let redactedText = input;
  const fingerprints: string[] = [];
  let redactionCount = 0;

  for (const { name, pattern } of SECRET_PATTERNS) {
    redactedText = redactedText.replace(pattern, (match) => {
      redactionCount += 1;
      const fingerprint = fingerprintSecret(match);

      fingerprints.push(`${name}:${fingerprint}`);

      return `[REDACTED:${name}:${fingerprint}]`;
    });
  }

  return RedactionResultSchema.parse({
    redactedText,
    redactionCount,
    fingerprints: [...new Set(fingerprints)],
  });
}

export function redactEnv(env: Record<string, string | undefined>): Record<string, string> {
  const result: Record<string, string> = {};

  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) {
      continue;
    }

    if (SENSITIVE_ENV_KEY_PATTERN.test(key)) {
      result[key] = `[REDACTED:${fingerprintSecret(value)}]`;
      continue;
    }

    result[key] = redactText(value).redactedText;
  }

  return result;
}

function fingerprintSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex").slice(0, 12);
}
