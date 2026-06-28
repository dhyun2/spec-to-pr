import {
  BudgetCheckResultSchema,
  type BudgetCheckResult,
  type BundleBudget,
} from "./performance-budget.js";

export type AssetSummary = {
  path: string;
  type: "script" | "stylesheet" | "image" | "font" | "document" | "other";
  transferBytes: number;
  initial?: boolean;
};

export function checkBundleBudget(input: {
  assets: AssetSummary[];
  budget: BundleBudget;
}): BudgetCheckResult {
  const failures = [];

  const initialJs = sumBytes(
    input.assets,
    (asset) => asset.type === "script" && asset.initial === true,
  );
  const initialCss = sumBytes(
    input.assets,
    (asset) => asset.type === "stylesheet" && asset.initial === true,
  );
  const imageBytes = maxBytes(input.assets, (asset) => asset.type === "image");
  const fontBytes = maxBytes(input.assets, (asset) => asset.type === "font");

  if (initialJs > input.budget.maxInitialJsBytes) {
    failures.push({
      kind: "initial-js",
      observedBytes: initialJs,
      budgetBytes: input.budget.maxInitialJsBytes,
      message: `Initial JS ${initialJs} exceeds budget ${input.budget.maxInitialJsBytes}`,
    });
  }

  if (initialCss > input.budget.maxInitialCssBytes) {
    failures.push({
      kind: "initial-css",
      observedBytes: initialCss,
      budgetBytes: input.budget.maxInitialCssBytes,
      message: `Initial CSS ${initialCss} exceeds budget ${input.budget.maxInitialCssBytes}`,
    });
  }

  if (imageBytes > input.budget.maxImageBytes) {
    failures.push({
      kind: "image",
      observedBytes: imageBytes,
      budgetBytes: input.budget.maxImageBytes,
      message: `Largest image ${imageBytes} exceeds budget ${input.budget.maxImageBytes}`,
    });
  }

  if (fontBytes > input.budget.maxFontBytes) {
    failures.push({
      kind: "font",
      observedBytes: fontBytes,
      budgetBytes: input.budget.maxFontBytes,
      message: `Largest font ${fontBytes} exceeds budget ${input.budget.maxFontBytes}`,
    });
  }

  for (const resourceBudget of input.budget.resources) {
    const observedBytes = maxBytes(
      input.assets,
      (asset) => asset.type === resourceBudget.resourceType,
    );

    if (observedBytes > resourceBudget.maxTransferBytes) {
      failures.push({
        kind: `resource-${resourceBudget.resourceType}`,
        observedBytes,
        budgetBytes: resourceBudget.maxTransferBytes,
        message: `Largest ${resourceBudget.resourceType} ${observedBytes} exceeds budget ${resourceBudget.maxTransferBytes}`,
      });
    }
  }

  return BudgetCheckResultSchema.parse({
    passed: failures.length === 0,
    failures,
  });
}

function sumBytes(assets: AssetSummary[], predicate: (asset: AssetSummary) => boolean): number {
  return assets.filter(predicate).reduce((sum, asset) => sum + asset.transferBytes, 0);
}

function maxBytes(assets: AssetSummary[], predicate: (asset: AssetSummary) => boolean): number {
  return Math.max(0, ...assets.filter(predicate).map((asset) => asset.transferBytes));
}
