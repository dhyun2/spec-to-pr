export type ModelRole = "fast" | "build" | "expert";
export type ModelRoutingStrategy = "adaptive-verified" | "pinned" | "custom";

export type CodexModelRoutingInput = {
  strategy?: ModelRoutingStrategy;
  pinnedModel?: string;
  customModels?: Partial<Record<ModelRole, string>>;
  /**
   * Adapter-provided availability signal. It is intentionally not a CLI
   * switch: a caller cannot claim a weaker verification environment is fine.
   */
  unavailableRoles?: ModelRole[];
};

export type CodexModelRouting = {
  workflow: {
    strategy: ModelRoutingStrategy;
    pinnedModel?: string;
    customModels?: Record<ModelRole, string>;
    qualityGaps: Array<{
      role: ModelRole;
      requestedModel: string;
      actualModel: string;
      reason: string;
    }>;
  };
  models: Record<ModelRole, string>;
};

/** Codex-owned catalog; workflow core only receives fast/build/expert roles. */
export const CODEX_DEFAULT_MODELS: Readonly<Record<ModelRole, string>> = {
  fast: "Luna",
  build: "Terra",
  expert: "Sol",
};

export function resolveCodexModelRouting(
  input?: CodexModelRoutingInput,
  legacyPinnedModel?: string,
): CodexModelRouting {
  const strategy =
    input?.strategy ?? (legacyPinnedModel === undefined ? "adaptive-verified" : "pinned");
  if (legacyPinnedModel !== undefined && input?.pinnedModel !== undefined) {
    throw new Error("Specify either model or modelRouting.pinnedModel, not both");
  }
  const pinnedModel = input?.pinnedModel ?? legacyPinnedModel;
  if (strategy === "pinned" && (pinnedModel === undefined || pinnedModel.trim() === "")) {
    throw new Error("pinned model routing requires pinnedModel");
  }
  if (strategy !== "pinned" && pinnedModel !== undefined) {
    throw new Error("pinnedModel is valid only with pinned routing");
  }
  const requested =
    strategy === "pinned"
      ? { fast: pinnedModel!, build: pinnedModel!, expert: pinnedModel! }
      : strategy === "custom"
        ? resolveCustomModels(input?.customModels)
        : { ...CODEX_DEFAULT_MODELS };
  if (strategy !== "custom" && input?.customModels !== undefined) {
    throw new Error("customModels are valid only with custom routing");
  }

  const unavailable = new Set(input?.unavailableRoles ?? []);
  const models: Record<ModelRole, string> = { ...requested };
  const qualityGaps: CodexModelRouting["workflow"]["qualityGaps"] = [];
  if (strategy !== "pinned") {
    for (const role of ["expert", "build"] as const) {
      if (!unavailable.has(role)) continue;
      const fallbackRole: ModelRole =
        role === "expert" && !unavailable.has("build") ? "build" : "fast";
      if (unavailable.has(fallbackRole)) continue;
      models[role] = requested[fallbackRole];
      qualityGaps.push({
        role,
        requestedModel: requested[role],
        actualModel: models[role],
        reason:
          "The requested higher-capability model was unavailable; the host used the next available configured role.",
      });
    }
  }

  return {
    workflow: {
      strategy,
      ...(strategy === "pinned" ? { pinnedModel: requested.fast } : {}),
      ...(strategy === "custom" ? { customModels: requested } : {}),
      qualityGaps,
    },
    models,
  };
}

function resolveCustomModels(
  models: CodexModelRoutingInput["customModels"],
): Record<ModelRole, string> {
  if (
    models?.fast === undefined ||
    models.build === undefined ||
    models.expert === undefined ||
    models.fast.trim() === "" ||
    models.build.trim() === "" ||
    models.expert.trim() === ""
  ) {
    throw new Error("custom model routing requires fastModel, buildModel, and expertModel");
  }
  return { fast: models.fast, build: models.build, expert: models.expert };
}
