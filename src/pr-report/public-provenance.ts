import path from "node:path";

import type { DeliveryProfile } from "../workflow/workflow-contracts.js";

export type PublicSourceProvenance = {
  kind: "brief" | "figma" | "openapi" | "docs" | "legacy" | "legacy-network" | "guidance";
  locator: string;
  resolvedLocator?: string;
  digest?: string;
  capturedAt?: string;
};

export function publicSourceRows(
  profile: DeliveryProfile,
  legacyRootDigest?: string,
): PublicSourceProvenance[] {
  const rows: PublicSourceProvenance[] = profile.sourceProvenance.map((source) => ({
    kind: source.kind,
    locator: publicLocator(source.locator),
    resolvedLocator: publicLocator(source.resolvedLocator),
    digest: source.digest,
    capturedAt: source.capturedAt,
  }));
  if (profile.figmaUrl !== undefined) {
    rows.push({ kind: "figma", locator: publicLocator(profile.figmaUrl) });
  }
  if (profile.legacyProjectRoot !== undefined) {
    rows.push({
      kind: "legacy",
      locator: "external-legacy-project",
      ...(legacyRootDigest === undefined ? {} : { digest: legacyRootDigest }),
    });
  }
  return rows;
}

function publicLocator(rawLocator: string): string {
  const locator = rawLocator.trim();
  try {
    const url = new URL(locator);
    if (url.protocol === "http:" || url.protocol === "https:") {
      url.username = "";
      url.password = "";
      url.search = "";
      url.hash = "";
      return url.toString();
    }
  } catch {
    // Project-local locators are handled below.
  }
  if (path.isAbsolute(locator) || /^[A-Za-z]:[\\/]/.test(locator)) {
    return `project-source/${path.basename(locator.replaceAll("\\", "/"))}`;
  }
  return locator
    .replace(/^~[\\/]+/, "")
    .replace(/^Users[\\/][^\\/]+[\\/]+/i, "")
    .replace(/^home[\\/][^\\/]+[\\/]+/i, "");
}
