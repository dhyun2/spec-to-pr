export const MAX_VISUAL_LINEAGE_ATTEMPTS = 3;

export type VisualLineageOutcomeStatus = "repair-required" | "closed" | "exhausted";

export type VisualLineageOutcome = {
  lineageId: string;
  sourcePacketId: string;
  attempt: 1 | 2 | 3;
  status: VisualLineageOutcomeStatus;
  repairEvidenceArtifactId?: string;
};

export type VisualLineageCheckpoint = {
  lineageId: string;
  attempts: number;
  repairRequired: boolean;
  sourcePacketId: string;
};

export type VisualLineage = {
  lineageId: string;
  packetId: string;
  attempts: number;
  nextAttempt: 1 | 2 | 3 | undefined;
};

export function createVisualLineage(
  previous: VisualLineageCheckpoint | undefined,
  packet: { id: string },
): VisualLineage {
  const inherits =
    previous?.repairRequired === true &&
    previous.sourcePacketId !== packet.id &&
    previous.attempts < MAX_VISUAL_LINEAGE_ATTEMPTS;
  const attempts = inherits ? previous.attempts : 0;
  return {
    lineageId: inherits ? previous.lineageId : packet.id,
    packetId: packet.id,
    attempts,
    nextAttempt: attempts < MAX_VISUAL_LINEAGE_ATTEMPTS ? ((attempts + 1) as 1 | 2 | 3) : undefined,
  };
}

export function nextVisualAttempt(input: {
  attempts: Array<{ attempt: number }>;
  acquisitionValid: boolean;
}): 1 | 2 | 3 | undefined {
  if (!input.acquisitionValid) return undefined;
  const completedAttempts = new Set(
    input.attempts
      .map((attempt) => attempt.attempt)
      .filter((attempt): attempt is 1 | 2 | 3 => attempt === 1 || attempt === 2 || attempt === 3),
  );
  for (const attempt of [1, 2, 3] as const) {
    if (!completedAttempts.has(attempt)) return attempt;
  }
  return undefined;
}

export function latestVisualLineageOutcome(
  outcomes: VisualLineageOutcome[],
  lineageId: string,
): VisualLineageOutcome | undefined {
  const committed = outcomes
    .filter((outcome) => outcome.lineageId === lineageId)
    .sort((left, right) => left.attempt - right.attempt);
  const attempts = new Set<number>();
  for (const outcome of committed) {
    if (attempts.has(outcome.attempt)) {
      throw new Error(
        `Duplicate committed visual lineage outcome for ${lineageId} attempt ${String(outcome.attempt)}`,
      );
    }
    attempts.add(outcome.attempt);
  }
  return committed.at(-1);
}
