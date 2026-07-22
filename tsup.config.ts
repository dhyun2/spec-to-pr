import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    "mcp/server": "src/mcp/server.ts",
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
  noExternal: [/@modelcontextprotocol\/sdk/, /pdfjs-dist/, /pngjs/, /typescript/, /zod/],
  banner: {
    js: '#!/usr/bin/env node\nimport { createRequire as __createRequire } from "node:module";\nimport { fileURLToPath as __fileURLToPath } from "node:url";\nimport { dirname as __dirnameOf } from "node:path";\nconst require = __createRequire(import.meta.url);\nconst __filename = __fileURLToPath(import.meta.url);\nconst __dirname = __dirnameOf(__filename);',
  },
});
