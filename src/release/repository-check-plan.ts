export type RepositoryCheckCommand = readonly [command: string, args: readonly string[]];

export type RepositoryCheckLane = {
  id: "sdk" | "schemas" | "mcp";
  commands: readonly RepositoryCheckCommand[];
};

export type RepositoryCheckPlan = {
  buildLanes: readonly RepositoryCheckLane[];
  readOnlyCommands: readonly RepositoryCheckCommand[];
  testCommand: RepositoryCheckCommand;
};

/**
 * Keep independently generated outputs in separate lanes. Every generated-output
 * check stays directly after its producer; tests wait until all tracked outputs
 * are stable so release/package tests cannot snapshot a partial build.
 */
export function buildRepositoryCheckPlan(): RepositoryCheckPlan {
  return {
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
  };
}
