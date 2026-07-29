import { defineConfig } from "playwright/test";

export default defineConfig({
  projects: [
    {
      name: "case4-chromium",
      use: {
        browserName: "chromium",
      },
    },
  ],
});
