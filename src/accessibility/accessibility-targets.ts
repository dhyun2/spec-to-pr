import { AccessibilityTargetSchema } from "./accessibility-model.js";
import type { AccessibilityTarget } from "./accessibility-model.js";

export function normalizeAccessibilityTargets(rawTargets: unknown[]): AccessibilityTarget[] {
  return rawTargets.map((target) =>
    AccessibilityTargetSchema.parse({
      ...(typeof target === "object" && target !== null && !Array.isArray(target) ? target : {}),
      sourceRequirementIds: rawArrayField(target, "sourceRequirementIds"),
      figmaArtifactIds: rawArrayField(target, "figmaArtifactIds"),
    }),
  );
}

function rawArrayField(target: unknown, key: string): unknown[] {
  if (typeof target !== "object" || target === null || Array.isArray(target)) {
    return [];
  }

  const value = (target as Record<string, unknown>)[key];

  return Array.isArray(value) ? value : [];
}
