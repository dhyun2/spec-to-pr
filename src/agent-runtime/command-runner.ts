import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { z } from "zod";

const execFileAsync = promisify(execFile);

export const SafeCommandInputSchema = z
  .object({
    cwd: z.string().trim().min(1),
    command: z.string().trim().min(1),
    args: z.array(z.string()).default([]),
    timeoutMs: z.number().int().positive().max(60_000).default(15_000),
  })
  .strict();

export const SafeCommandOutputSchema = z
  .object({
    cwd: z.string(),
    command: z.string(),
    args: z.array(z.string()),
    stdout: z.string(),
    stderr: z.string(),
  })
  .strict();

export type SafeCommandInput = z.infer<typeof SafeCommandInputSchema>;
export type SafeCommandOutput = z.infer<typeof SafeCommandOutputSchema>;

export async function runCommand(rawInput: SafeCommandInput): Promise<SafeCommandOutput> {
  const input = SafeCommandInputSchema.parse(rawInput);

  if (input.command !== "git") {
    throw new Error(`Agent runtime only permits git commands, received: ${input.command}`);
  }

  const { stdout, stderr } = await execFileAsync(input.command, input.args, {
    cwd: input.cwd,
    timeout: input.timeoutMs,
    maxBuffer: 1024 * 1024,
    shell: false,
    encoding: "utf8",
  });

  return SafeCommandOutputSchema.parse({
    cwd: input.cwd,
    command: input.command,
    args: input.args,
    stdout: String(stdout),
    stderr: String(stderr),
  });
}
