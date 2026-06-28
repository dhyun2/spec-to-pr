import type { ReleaseManifest } from "./release-manifest.js";

export function renderReleaseNotes(manifest: ReleaseManifest): string {
  return [
    `# spec-to-pr ${manifest.version}`,
    "",
    "## Release Summary",
    "",
    `Built at: ${manifest.builtAt}`,
    `Package: ${manifest.packagePath}`,
    `Checksum: ${manifest.packageSha256}`,
    "",
    "## Gate Status",
    "",
    `- Eval status: ${manifest.evalStatus}`,
    `- Security status: ${manifest.securityStatus}`,
    `- Plugin validation: ${manifest.pluginValidationStatus}`,
    "",
    "## Feature Status",
    "",
    "| Task | Name | Status | Evidence |",
    "|---|---|---|---|",
    ...manifest.features.map(
      (feature) =>
        `| ${feature.taskId} | ${feature.name} | ${feature.status} | ${
          feature.evidence.join("<br>") || "-"
        } |`,
    ),
    "",
    "## Included Files",
    "",
    ...manifest.includedFiles.map((file) => `- ${file}`),
    "",
    "## Publication",
    "",
    "This task prepares a release candidate only. It does not publish to npm, GitHub Releases, or any marketplace.",
    "",
  ].join("\n");
}
