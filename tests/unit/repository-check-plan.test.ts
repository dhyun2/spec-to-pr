import { describe, expect, it } from "vitest";

import { buildRepositoryCheckPlan } from "../../src/release/repository-check-plan.js";

describe("repository check plan", () => {
  it("runs disjoint generated-output lanes before read-only validation and tests", () => {
    expect(buildRepositoryCheckPlan()).toEqual({
      buildLanes: [
        {
          id: "sdk",
          commands: [
            ["pnpm", ["sdk:build"]],
            ["pnpm", ["sdk:check-dist"]],
          ],
        },
        {
          id: "schemas",
          commands: [
            ["pnpm", ["schemas:build"]],
            ["pnpm", ["schemas:check"]],
          ],
        },
        {
          id: "mcp",
          commands: [
            ["pnpm", ["build"]],
            ["pnpm", ["bundle:check-dist"]],
          ],
        },
      ],
      readOnlyCommands: [
        ["pnpm", ["format:check"]],
        ["pnpm", ["typecheck"]],
      ],
      testCommand: ["pnpm", ["test"]],
    });
  });
});
