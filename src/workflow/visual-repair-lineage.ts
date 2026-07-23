export const MAX_VISUAL_LINEAGE_ATTEMPTS = 3;

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
  if (completedAttempts.size >= MAX_VISUAL_LINEAGE_ATTEMPTS) return undefined;
  return (completedAttempts.size + 1) as 1 | 2 | 3;
}
