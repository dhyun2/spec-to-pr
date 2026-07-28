import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createArtifactId } from "../../src/runtime/id-factory.js";
import type { ArtifactRef } from "../../src/runtime/artifact.js";
import {
  assertBaselineIsolation,
  type BaselineIsolationEvidence,
} from "../../src/visual/baseline-isolation.js";
import type { ImplementationReviewPacket } from "../../src/workflow/workflow-contracts.js";

const sha256 = (content: string | Buffer) =>
  `sha256:${createHash("sha256").update(content).digest("hex")}` as const;

describe("visual baseline isolation", () => {
  const registeredExcludedPaths = [
    "src/shop.test.ts",
    "tests/fixtures/baseline-overlay.html",
    "visual/shop-baseline.png",
    "visual/actual/isolation.json",
  ];
  let projectRoot: string;
  let packet: ImplementationReviewPacket;
  let baseline: ArtifactRef;

  beforeEach(async () => {
    projectRoot = await mkdtemp(path.join(os.tmpdir(), "baseline-isolation-"));
    await mkdir(path.join(projectRoot, "src"), { recursive: true });
    await mkdir(path.join(projectRoot, "dist"), { recursive: true });
    await mkdir(path.join(projectRoot, "tests/fixtures"), { recursive: true });
    await mkdir(path.join(projectRoot, "visual/actual"), { recursive: true });
    const baselineBytes = Buffer.from("immutable-figma-baseline", "utf8");
    await mkdir(path.join(projectRoot, "visual"), { recursive: true });
    await writeFile(path.join(projectRoot, "visual/shop-baseline.png"), baselineBytes);
    baseline = {
      id: createArtifactId(),
      kind: "screenshot",
      uri: `artifact://sha256/${sha256(baselineBytes).slice("sha256:".length)}`,
      mediaType: "image/png",
      digest: sha256(baselineBytes),
      producedBy: "orchestrator",
      evidenceIds: [],
      createdAt: "2026-07-28T00:00:00.000Z",
      metadata: { projectRelativePath: "visual/shop-baseline.png" },
    };
    packet = {
      id: `packet_${"a".repeat(64)}`,
      runId: `run_${"b".repeat(32)}`,
      revision: 1,
      baseSha: "1".repeat(40),
      headSha: "2".repeat(40),
      evidenceDigest: `sha256:${"3".repeat(64)}`,
      diffDigest: `sha256:${"4".repeat(64)}`,
      changedFiles: [
        "src/shop.tsx",
        "src/shop.test.ts",
        "tests/fixtures/baseline-overlay.html",
        "visual/shop-baseline.png",
        "visual/actual/isolation.json",
      ],
    };
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  async function writeProductFile(
    relativePath: string,
    content: string,
  ): Promise<{ path: string; digest: `sha256:${string}` }> {
    const absolutePath = path.join(projectRoot, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content, "utf8");
    return { path: relativePath, digest: sha256(content) };
  }

  function evidence(
    checkedSourceFiles: BaselineIsolationEvidence["checkedSourceFiles"],
    overrides: Partial<BaselineIsolationEvidence> = {},
  ): BaselineIsolationEvidence {
    return {
      schemaVersion: "baseline-isolation-v1",
      reviewPacketId: packet.id,
      headSha: packet.headSha,
      baselineArtifacts: [
        {
          artifactId: baseline.id,
          path: "visual/shop-baseline.png",
          digest: baseline.digest,
        },
      ],
      checkedSourceFiles,
      requestedResources: [],
      renderedMedia: [],
      violations: [],
      status: "passed",
      ...overrides,
    };
  }

  async function assertInvalid(
    content: string,
    overrides: Partial<BaselineIsolationEvidence> = {},
  ): Promise<void> {
    const source = await writeProductFile("src/shop.tsx", content);
    await expect(
      assertBaselineIsolation({
        projectRoot,
        packet,
        baselineArtifacts: [baseline],
        evidence: evidence([source], overrides),
        excludedPaths: registeredExcludedPaths,
      }),
    ).rejects.toThrow(/VISUAL_BASELINE_ISOLATION_INVALID/);
  }

  it("accepts semantic product source with exact packet-bound source coverage", async () => {
    const source = await writeProductFile(
      "src/shop.tsx",
      "export const Shop = () => <main><h1>Nearby chargers</h1></main>;\n",
    );

    await expect(
      assertBaselineIsolation({
        projectRoot,
        packet,
        baselineArtifacts: [baseline],
        evidence: evidence([source]),
        excludedPaths: registeredExcludedPaths,
      }),
    ).resolves.toEqual(evidence([source]));
  });

  it.each([
    [
      "imports the baseline PNG",
      "import baseline from '../visual/shop-baseline.png'; export { baseline };\n",
    ],
    [
      "uses the baseline in a CSS URL",
      "export const css = `.shop { background-image: url('../visual/shop-baseline.png') }`;\n",
    ],
    [
      "embeds the baseline in an image",
      "export const Shop = () => <img src='/visual/shop-baseline.png' alt='' />;\n",
    ],
    [
      "embeds the baseline in an SVG image",
      "export const Shop = () => <svg><image href='/visual/shop-baseline.png' /></svg>;\n",
    ],
    [
      "draws the baseline onto a canvas",
      "const image = new Image(); image.src = '/visual/shop-baseline.png'; context.drawImage(image, 0, 0);\n",
    ],
    [
      "places a full-frame baseline overlay",
      "export const Overlay = () => <img style={{position:'fixed',inset:0,width:'100vw',height:'100vh'}} src='/visual/shop-baseline.png' />;\n",
    ],
    [
      "contains the immutable baseline digest",
      `export const hiddenBaseline = '${sha256(Buffer.from("immutable-figma-baseline"))}';\n`,
    ],
    [
      "contains the immutable artifact URL",
      `export const hiddenBaseline = '${`artifact://sha256/${sha256(Buffer.from("immutable-figma-baseline")).slice("sha256:".length)}`}';\n`,
    ],
  ])("rejects product source that %s", async (_name, content) => {
    await assertInvalid(content);
  });

  it("rejects requested baseline artifact and path URLs", async () => {
    const source = await writeProductFile("src/shop.tsx", "export const Shop = 'semantic';\n");
    for (const url of ["https://app.example/visual/shop-baseline.png", baseline.uri]) {
      await expect(
        assertBaselineIsolation({
          projectRoot,
          packet,
          baselineArtifacts: [baseline],
          evidence: evidence([source], {
            requestedResources: [{ url }],
          }),
          excludedPaths: registeredExcludedPaths,
        }),
      ).rejects.toThrow(/VISUAL_BASELINE_ISOLATION_INVALID/);
    }
  });

  it("rejects requested or rendered media renamed with the baseline digest", async () => {
    const source = await writeProductFile("src/shop.tsx", "export const Shop = 'semantic';\n");
    for (const override of [
      {
        requestedResources: [
          {
            url: "https://app.example/assets/innocent-name.png",
            digest: baseline.digest,
          },
        ],
      },
      {
        renderedMedia: [
          {
            selector: "#hero",
            sourceUrl: "https://app.example/assets/innocent-name.png",
            digest: baseline.digest,
          },
        ],
      },
    ]) {
      await expect(
        assertBaselineIsolation({
          projectRoot,
          packet,
          baselineArtifacts: [baseline],
          evidence: evidence([source], override),
          excludedPaths: registeredExcludedPaths,
        }),
      ).rejects.toThrow(/VISUAL_BASELINE_ISOLATION_INVALID/);
    }
  });

  it("rejects rendered image and SVG baseline source URLs", async () => {
    const source = await writeProductFile("src/shop.tsx", "export const Shop = 'semantic';\n");
    await expect(
      assertBaselineIsolation({
        projectRoot,
        packet,
        baselineArtifacts: [baseline],
        evidence: evidence([source], {
          renderedMedia: [
            { selector: "img#overlay", sourceUrl: "https://app.example/visual/shop-baseline.png" },
            {
              selector: "svg image",
              sourceUrl: "https://app.example/visual/shop-baseline.png",
            },
          ],
        }),
        excludedPaths: registeredExcludedPaths,
      }),
    ).rejects.toThrow(/VISUAL_BASELINE_ISOLATION_INVALID/);
  });

  it("derives changed, declared, design-system, and browser bundle sources exactly", async () => {
    const changed = await writeProductFile("src/shop.tsx", "export const Shop = 'semantic';\n");
    const declared = await writeProductFile("src/declared.vue", "<template>semantic</template>\n");
    const designSystem = await writeProductFile(
      "src/design-system.scss",
      ".shop { color: var(--semantic-text); }\n",
    );
    const bundle = await writeProductFile("dist/shop.js", "console.log('semantic');\n");

    const input = {
      projectRoot,
      packet,
      baselineArtifacts: [baseline],
      implementationSourceFiles: [declared.path],
      designSystemSourceFiles: [designSystem.path],
      browserBundlePaths: [bundle.path],
      evidence: evidence([changed, declared, designSystem, bundle]),
      excludedPaths: registeredExcludedPaths,
    };
    await expect(assertBaselineIsolation(input)).resolves.toEqual(input.evidence);

    for (const checkedSourceFiles of [
      [changed, declared, designSystem],
      [
        changed,
        declared,
        designSystem,
        bundle,
        { path: "tests/fixtures/baseline-overlay.html", digest: sha256("fixture") },
      ],
      [changed, declared, designSystem, { ...bundle, digest: `sha256:${"9".repeat(64)}` as const }],
    ]) {
      await expect(
        assertBaselineIsolation({
          ...input,
          evidence: evidence(checkedSourceFiles),
        }),
      ).rejects.toThrow(/VISUAL_BASELINE_ISOLATION_INVALID/);
    }
  });

  it("rejects stale packet/head/baseline bindings and caller-reported violations", async () => {
    const source = await writeProductFile("src/shop.tsx", "export const Shop = 'semantic';\n");
    const cases: Array<Partial<BaselineIsolationEvidence>> = [
      { reviewPacketId: `packet_${"f".repeat(64)}` },
      { headSha: "f".repeat(40) },
      {
        baselineArtifacts: [
          {
            artifactId: baseline.id,
            path: "visual/renamed.png",
            digest: baseline.digest,
          },
        ],
      },
      {
        violations: [{ kind: "rendered-baseline", evidence: "overlay matched baseline" }],
      },
    ];
    for (const overrides of cases) {
      await expect(
        assertBaselineIsolation({
          projectRoot,
          packet,
          baselineArtifacts: [baseline],
          evidence: evidence([source], overrides),
          excludedPaths: registeredExcludedPaths,
        }),
      ).rejects.toThrow(/VISUAL_BASELINE_ISOLATION_INVALID/);
    }
  });

  it("scans implementation source inside directories named fixtures unless explicitly excluded", async () => {
    const source = await writeProductFile("src/shop.tsx", "export const Shop = 'semantic';\n");
    const runtime = await writeProductFile(
      "src/fixtures/runtime.ts",
      "export const runtimeFixture = 'production';\n",
    );
    const runtimePacket = {
      ...packet,
      changedFiles: [...packet.changedFiles, runtime.path],
    };
    const input = {
      projectRoot,
      packet: runtimePacket,
      baselineArtifacts: [baseline],
      evidence: evidence([source, runtime]),
      excludedPaths: registeredExcludedPaths,
    };

    await expect(assertBaselineIsolation(input)).resolves.toEqual(input.evidence);

    const maliciousRuntime = await writeProductFile(
      runtime.path,
      "export const runtimeFixture = '/visual/shop-baseline.png';\n",
    );
    await expect(
      assertBaselineIsolation({
        ...input,
        evidence: evidence([source, maliciousRuntime]),
      }),
    ).rejects.toThrow(/VISUAL_BASELINE_ISOLATION_INVALID/);
  });

  it("rejects single, dot-segment, and repeatedly percent-encoded full baseline paths", async () => {
    for (const encodedPath of [
      "%2Fvisual%2Fshop-baseline.png",
      "%2E%2Fvisual%2Fshop-baseline.png",
      "%252Fvisual%252Fshop-baseline.png",
    ]) {
      await assertInvalid(`export const hiddenBaseline = '${encodedPath}';\n`);
    }

    const source = await writeProductFile("src/shop.tsx", "export const Shop = 'semantic';\n");
    for (const override of [
      {
        requestedResources: [{ url: "https://app.example/%2Fvisual%2Fshop-baseline.png" }],
      },
      {
        requestedResources: [{ url: "https://app.example/%252E%252Fvisual%252Fshop-baseline.png" }],
      },
      {
        renderedMedia: [
          {
            selector: "img#overlay",
            sourceUrl: "https://app.example/%252Fvisual%252Fshop-baseline.png",
          },
        ],
      },
    ]) {
      await expect(
        assertBaselineIsolation({
          projectRoot,
          packet,
          baselineArtifacts: [baseline],
          evidence: evidence([source], override),
          excludedPaths: registeredExcludedPaths,
        }),
      ).rejects.toThrow(/VISUAL_BASELINE_ISOLATION_INVALID/);
    }
  });

  it("allows unrelated resources that share only the baseline basename", async () => {
    const source = await writeProductFile(
      "src/shop.tsx",
      "export const unrelatedAsset = '/assets/shop-baseline.png';\n",
    );
    const valid = evidence([source], {
      requestedResources: [{ url: "https://app.example/assets/shop-baseline.png" }],
      renderedMedia: [
        {
          selector: "img#unrelated",
          sourceUrl: "https://app.example/assets/shop-baseline.png",
        },
      ],
    });

    await expect(
      assertBaselineIsolation({
        projectRoot,
        packet,
        baselineArtifacts: [baseline],
        evidence: valid,
        excludedPaths: registeredExcludedPaths,
      }),
    ).resolves.toEqual(valid);
  });
});
