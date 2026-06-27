import { mkdir, writeFile } from "node:fs/promises";

import { z } from "zod";

import {
  AgentResultSchema,
  ArtifactRefSchema,
  CheckResultSchema,
  DecisionSchema,
  EvidenceRefSchema,
  GapSchema,
  RUNTIME_CONTRACT_VERSION,
  SourceRefSchema,
} from "../src/rumtime/index.ts";

const outputDirectory = new URL("../schemas/runtime/", import.meta.url);

const schemas = {
  "agent-result.schema.json": AgentResultSchema,
  "artifact-ref.schema.json": ArtifactRefSchema,
  "check-result.schema.json": CheckResultSchema,
  "decision.schema.json": DecisionSchema,
  "evidence-ref.schema.json": EvidenceRefSchema,
  "gap.schema.json": GapSchema,
  "source-ref.schema.json": SourceRefSchema,
} as const;

await mkdir(outputDirectory, { recursive: true });

const index = {
  schemaVersion: RUNTIME_CONTRACT_VERSION,
  dialect: "https://json-schema.org/draft/2020-12/schema",
  files: Object.keys(schemas).sort(),
};

for (const [fileName, schema] of Object.entries(schemas)) {
  const jsonSchema = z.toJSONSchema(schema, {
    target: "draft-2020-12",
  }) as Record<string, unknown>;

  jsonSchema.$schema = "https://json-schema.org/draft/2020-12/schema";
  jsonSchema.$id = `https://spec-to-pr.local/schemas/runtime/${fileName}`;

  await writeFile(
    new URL(fileName, outputDirectory),
    `${JSON.stringify(jsonSchema, null, 2)}\n`,
    "utf8",
  );
}

await writeFile(
  new URL("index.json", outputDirectory),
  `${JSON.stringify(index, null, 2)}\n`,
  "utf8",
);
