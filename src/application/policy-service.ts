import { z } from "zod";

import { classifyCommand, CommandInvocationSchema } from "../security/command-policy.js";
import { validateWorkspacePath, ValidateWorkspacePathInputSchema } from "../security/path-policy.js";
import { redactEnv, redactText } from "../security/secret-redactor.js";
import { UntrustedContentInputSchema, wrapUntrustedContent } from "../security/untrusted-content.js";

export const RedactTextInputSchema = z
  .object({
    text: z.string(),
  })
  .strict();

export const RedactEnvInputSchema = z
  .object({
    env: z.record(z.string(), z.string().optional()),
  })
  .strict();

export class PolicyService {
  public async validatePath(rawInput: unknown) {
    const input = ValidateWorkspacePathInputSchema.parse(rawInput);

    return validateWorkspacePath(input);
  }

  public classifyCommand(rawInput: unknown) {
    const input = CommandInvocationSchema.parse(rawInput);

    return classifyCommand(input);
  }

  public redactText(rawInput: unknown) {
    const input = RedactTextInputSchema.parse(rawInput);

    return redactText(input.text);
  }

  public redactEnv(rawInput: unknown) {
    const input = RedactEnvInputSchema.parse(rawInput);

    return redactEnv(input.env);
  }

  public wrapUntrustedContent(rawInput: unknown) {
    const input = UntrustedContentInputSchema.parse(rawInput);

    return {
      wrappedContent: wrapUntrustedContent(input),
    };
  }
}
