import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    "compare-images": "scripts/lite/compare-images.ts",
    "check-gitlab-mr": "scripts/lite/check-gitlab-mr.ts",
  },
  outDir: "skills/spec-to-pr/scripts",
  format: ["cjs"],
  platform: "node",
  target: "node22",
  bundle: true,
  splitting: false,
  sourcemap: false,
  clean: false,
  dts: false,
  minify: true,
  outExtension() {
    return { js: ".cjs" };
  },
  noExternal: [/pngjs/],
});
