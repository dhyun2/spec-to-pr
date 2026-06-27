import { randomUUID } from "node:crypto";

import {
  AgentResultIdSchema,
  ArtifactIdSchema,
  CheckIdSchema,
  DecisionIdSchema,
  EvidenceIdSchema,
  GapIdSchema,
  RunIdSchema,
  SourceIdSchema,
} from "./ids.js";
import type {
  AgentResultId,
  ArtifactId,
  CheckId,
  DecisionId,
  EvidenceId,
  GapId,
  RunId,
  SourceId,
} from "./ids.js";

function compactUuid(): string {
  return randomUUID().replaceAll("-", "");
}

export function createRunId(): RunId {
  return RunIdSchema.parse(`run_${compactUuid()}`);
}

export function createSourceId(): SourceId {
  return SourceIdSchema.parse(`src_${compactUuid()}`);
}

export function createEvidenceId(): EvidenceId {
  return EvidenceIdSchema.parse(`ev_${compactUuid()}`);
}

export function createArtifactId(): ArtifactId {
  return ArtifactIdSchema.parse(`art_${compactUuid()}`);
}

export function createGapId(): GapId {
  return GapIdSchema.parse(`gap_${compactUuid()}`);
}

export function createDecisionId(): DecisionId {
  return DecisionIdSchema.parse(`dec_${compactUuid()}`);
}

export function createAgentResultId(): AgentResultId {
  return AgentResultIdSchema.parse(`ar_${compactUuid()}`);
}

export function createCheckId(): CheckId {
  return CheckIdSchema.parse(`chk_${compactUuid()}`);
}
