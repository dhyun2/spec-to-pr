import { randomUUID } from "node:crypto";

import {
  TraceEdgeIdSchema,
  TraceNodeIdSchema,
  type TraceEdgeId,
  type TraceNodeId,
} from "./traceability-contracts.js";

function compactUuid(): string {
  return randomUUID().replaceAll("-", "");
}

export function createTraceNodeId(): TraceNodeId {
  return TraceNodeIdSchema.parse(`tn_${compactUuid()}`);
}

export function createTraceEdgeId(): TraceEdgeId {
  return TraceEdgeIdSchema.parse(`te_${compactUuid()}`);
}
