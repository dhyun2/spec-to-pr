import type { VisualTarget } from "./visual-model.js";

export type BrowserCaptureResult = {
  targetId: string;
  screenshot: Buffer;
  url: string;
};

export async function captureBrowserScreenshot(input: {
  baseUrl: string;
  target: VisualTarget;
  timeoutMs?: number;
}): Promise<BrowserCaptureResult> {
  const { chromium } = await import("playwright");
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
