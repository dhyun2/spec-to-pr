import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    "mcp/server": "src/mcp/server.ts",
    "mcp/visual-comparison-worker": "src/visual/visual-comparison-worker.ts",
  },
  format: ["esm"],
  platform: "node",
  target: "node22",
  bundle: true,
  splitting: true,
  sourcemap: false,
  clean: true,
  dts: false,
  minify: true,
  esbuildOptions(options) {
    options.chunkNames = "mcp/[name]-[hash]";
  },
  external: ["playwright", "playwright-core", /^chromium-bidi/],
  noExternal: [/@babel\/parser/, /@modelcontextprotocol\/sdk/, /pdfjs-dist/, /pngjs/, /zod/],
  banner: {
    js: '#!/usr/bin/env node\nimport { createRequire as __createRequire } from "node:module";\nimport { fileURLToPath as __fileURLToPath } from "node:url";\nimport { dirname as __dirnameOf } from "node:path";\nconst require = __createRequire(import.meta.url);\nconst __filename = __fileURLToPath(import.meta.url);\nconst __dirname = __dirnameOf(__filename);',
  },
});
