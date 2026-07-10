import { describe, expect, it } from "vitest";

import { redactEnv, redactText } from "../../src/security/secret-redactor.js";

describe("secret redactor", () => {
  it("redacts bearer tokens", () => {
    const result = redactText("Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456");

    expect(result.redactionCount).toBe(1);
    expect(result.redactedText).toContain("[REDACTED:bearer-token:");
  });

  it("redacts sensitive env values", () => {
    const result = redactEnv({
      GITHUB_TOKEN: "ghp_abcdefghijklmnopqrstuvwxyz123456",
      NODE_ENV: "test",
    });

    expect(result.GITHUB_TOKEN).toContain("[REDACTED:");
    expect(result.NODE_ENV).toBe("test");
  });
});
