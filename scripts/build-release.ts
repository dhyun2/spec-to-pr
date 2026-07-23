import process from "node:process";

import { ReleaseService } from "../src/application/release-service.js";

const version = process.argv[2];
const mode = process.argv[3] ?? "--dry-run";
const unexpectedArgument = process.argv[4];

if (version === undefined || !["--dry-run", "--full"].includes(mode) || unexpectedArgument) {
  console.error("Usage: pnpm release:build <version> [--dry-run|--full]");
  process.exit(1);
}

const service = new ReleaseService(process.cwd());
const release = await service.buildReleasePackage({
  version,
  allowDirty: mode === "--dry-run",
});
const notes = await service.generateReleaseNotes({
  manifestPath: release.manifestPath,
});

console.log(`Release mode: ${mode}`);
console.log(`Package: ${release.build.packagePath}`);
console.log(`Checksum: ${release.build.sha256}`);
console.log(`Manifest: ${release.manifestPath}`);
console.log(`Notes: ${notes.notesPath}`);
console.log(`Verification: ${release.verification.status}`);

if (release.verification.status !== "passed") {
  console.error("Release verification failed.");
  for (const failure of release.verification.failures) {
    console.error(`- ${failure}`);
  }
  process.exitCode = 1;
}
