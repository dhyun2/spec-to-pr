import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    "mcp/server": "src/mcp/server.ts",
  },
  format: ["esm"],
  platform: "node",
  target: "node22",
  bundle: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  dts: false,
  minify: false,
  noExternal: [/@modelcontextprotocol\/sdk/, /zod/, /typescript/],
  banner: {
    js: '#!/usr/bin/env node\nimport { createRequire as __createRequire } from "node:module";\nimport { fileURLToPath as __fileURLToPath } from "node:url";\nimport { dirname as __dirnameOf } from "node:path";\nconst require = __createRequire(import.meta.url);\nconst __filename = __fileURLToPath(import.meta.url);\nconst __dirname = __dirnameOf(__filename);',
  },
});
