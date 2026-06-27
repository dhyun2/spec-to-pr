import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { PolicyDecisionSchema } from "./policy.js";

export const SecurityAuditEventSchema = z
  .object({
    timestamp: z.string().datetime({ offset: true }),
    eventType: z.enum(["path", "command", "redaction", "untrusted-content", "policy"]),
    runId: z.string().optional(),
    actor: z.string().trim().min(1).max(200).default("system"),
    decision: PolicyDecisionSchema.optional(),
    summary: z.string().trim().min(1).max(2_000),
    metadata: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();

export type SecurityAuditEvent = z.infer<typeof SecurityAuditEventSchema>;

export class SecurityAuditLog {
  public constructor(private readonly filePath: string) {}

  public async append(rawEvent: SecurityAuditEvent): Promise<void> {
    const event = SecurityAuditEventSchema.parse(rawEvent);

    await mkdir(path.dirname(this.filePath), {
      recursive: true,
      mode: 0o700,
    });

    await appendFile(this.filePath, `${JSON.stringify(event)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
  }
}
