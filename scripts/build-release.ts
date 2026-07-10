import process from "node:process";

import { ReleaseService } from "../src/application/release-service.js";

const version = process.argv[2];
const mode = process.argv[3] ?? "--dry-run";

if (version === undefined || !["--dry-run", "--full"].includes(mode)) {
  console.error("Usage: pnpm release:build <version> [--dry-run|--full]");
  process.exit(1);
}

const service = new ReleaseService(process.cwd());
const evalResult = await service.runEvalSuite({});
const hardeningResult = await service.runSecurityHardeningSuite({});

if (evalResult.report.status !== "passed" || hardeningResult.report.status !== "passed") {
  console.error("Release gates failed. Package build skipped.");
  console.error(`Eval status: ${evalResult.report.status}`);
  console.error(`Security status: ${hardeningResult.report.status}`);
  process.exit(1);
}

const release = await service.buildReleasePackage({
  version,
});
const verification = await service.verifyReleasePackage({
  manifestPath: release.manifestPath,
});
const notes = await service.generateReleaseNotes({
  manifestPath: release.manifestPath,
});

console.log(`Release mode: ${mode}`);
console.log(`Package: ${release.build.packagePath}`);
console.log(`Checksum: ${release.build.sha256}`);
console.log(`Manifest: ${release.manifestPath}`);
console.log(`Notes: ${notes.notesPath}`);
console.log(`Verification: ${verification.verification.status}`);
