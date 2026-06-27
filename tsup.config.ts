import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    'mcp/server': 'src/mcp/server.ts',
  },
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  bundle: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  dts: false,
  minify: false,
  noExternal: [/@modelcontextprotocol\/sdk/, /zod/],
  banner: {
    js: '#!/usr/bin/env node',
  },
});
