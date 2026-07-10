import type { VisualTarget } from "./visual-model.js";

type PlaywrightModule = typeof import("playwright");
type PlaywrightChromium = PlaywrightModule["chromium"];
type PlaywrightImporter = () => Promise<Pick<PlaywrightModule, "chromium">>;

export type BrowserCaptureResult = {
  targetId: string;
  screenshot: Buffer;
  url: string;
};

export async function loadPlaywrightChromium(
  importer: PlaywrightImporter = () => import("playwright"),
): Promise<PlaywrightChromium> {
  try {
    return (await importer()).chromium;
  } catch (error: unknown) {
    if (isMissingPlaywrightError(error)) {
      throw new Error(
        [
          "Playwright is required for visual screenshot capture but is not available in this plugin runtime.",
          "Install plugin runtime dependencies or run visual capture in a host environment that provides Playwright.",
          "The spec-to-pr release package intentionally excludes node_modules, so Doctor/kernel checks must not rely on plugin-cache package imports.",
        ].join(" "),
        {
          cause: error,
        },
      );
    }

    throw error;
  }
}

export async function captureBrowserScreenshot(input: {
  baseUrl: string;
  target: VisualTarget;
  timeoutMs?: number;
}): Promise<BrowserCaptureResult> {
  const chromium = await loadPlaywrightChromium();
  const browser = await chromium.launch({
    headless: true,
  });

  try {
    const page = await browser.newPage({
      viewport: {
        width: input.target.viewport.width,
        height: input.target.viewport.height,
      },
      deviceScaleFactor: input.target.viewport.deviceScaleFactor,
      isMobile: input.target.viewport.isMobile,
    });
    const url = new URL(input.target.route, input.baseUrl).toString();

    await page.goto(url, {
      waitUntil: "networkidle",
      timeout: input.timeoutMs ?? 30_000,
    });

    await page.addStyleTag({
      content: `
        *, *::before, *::after {
          animation-duration: 0s !important;
          animation-delay: 0s !important;
          transition-duration: 0s !important;
          transition-delay: 0s !important;
          caret-color: transparent !important;
        }
      `,
    });

    const screenshot = await page.screenshot({
      type: "png",
      fullPage: false,
      animations: "disabled",
    });

    return {
      targetId: input.target.id,
      screenshot,
      url,
    };
  } finally {
    await browser.close();
  }
}

function isMissingPlaywrightError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const code = (error as { code?: unknown }).code;

  return code === "ERR_MODULE_NOT_FOUND" && error.message.includes("playwright");
}
