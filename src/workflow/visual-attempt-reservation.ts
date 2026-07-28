export const VISUAL_ATTEMPT_LEASE_MS = 15 * 60 * 1_000;

export type VisualAttemptNumber = 1 | 2 | 3;

export type VisualReservationStatus = "in-progress" | "committed" | "aborted" | "stale";

export type VisualAttemptReservation = {
  submissionIdentity: string;
  attempt: VisualAttemptNumber;
  status: VisualReservationStatus;
  ownerToken: string;
  reservedAt: string;
  updatedAt: string;
  reportArtifactId?: string;
  reportDigest?: string;
};

export type VisualAttemptReservationEvent = Omit<VisualAttemptReservation, "status"> & {
  status: VisualReservationStatus | "completed" | "failed";
};

export type VisualReservationSummary = {
  committed: VisualAttemptReservation[];
  active?: VisualAttemptReservation;
  recoverable?: VisualAttemptReservation;
};

type IndexedReservation = {
  reservation: VisualAttemptReservation;
  index: number;
};

export function reduceVisualReservations(
  events: readonly VisualAttemptReservationEvent[],
  nowIso: string,
): VisualReservationSummary {
  const now = Date.parse(nowIso);
  const byOwner = new Map<string, IndexedReservation>();

  events.forEach((event, index) => {
    const reservation = normalizeReservation(event, now);
    const current = byOwner.get(reservation.ownerToken);
    if (current === undefined || isLater(reservation, index, current)) {
      byOwner.set(reservation.ownerToken, { reservation, index });
    }
  });

  const byIdentity = new Map<string, IndexedReservation>();
  for (const candidate of byOwner.values()) {
    const current = byIdentity.get(candidate.reservation.submissionIdentity);
    if (current === undefined || isLater(candidate.reservation, candidate.index, current)) {
      byIdentity.set(candidate.reservation.submissionIdentity, candidate);
    }
  }

  const collapsed = [...byIdentity.values()];
  const committed: VisualAttemptReservation[] = [];
  for (const attempt of [1, 2, 3] as const) {
    const candidates = collapsed.filter(
      ({ reservation }) =>
        reservation.status === "committed" &&
        reservation.attempt === attempt &&
        hasCompleteReport(reservation),
    );
    if (candidates.length > 1) {
      throw new Error(`Duplicate committed visual attempt ${String(attempt)}`);
    }
    const candidate = candidates[0];
    if (candidate === undefined) break;
    committed.push(candidate.reservation);
  }

  const active = latest(
    collapsed.filter(({ reservation }) => reservation.status === "in-progress"),
  )?.reservation;
  const recoverable = latest(
    collapsed.filter(({ reservation }) => reservation.status === "stale"),
  )?.reservation;

  return {
    committed,
    ...(active === undefined ? {} : { active }),
    ...(recoverable === undefined ? {} : { recoverable }),
  };
}

export function nextCommittedVisualAttempt(
  summary: VisualReservationSummary,
): VisualAttemptNumber | undefined {
  if (summary.committed.length >= 3) return undefined;
  return (summary.committed.length + 1) as VisualAttemptNumber;
}

function normalizeReservation(
  event: VisualAttemptReservationEvent,
  now: number,
): VisualAttemptReservation {
  const normalizedStatus =
    event.status === "completed"
      ? "committed"
      : event.status === "failed"
        ? "aborted"
        : event.status;
  const status =
    normalizedStatus === "in-progress" &&
    Number.isFinite(now) &&
    now - Date.parse(event.reservedAt) > VISUAL_ATTEMPT_LEASE_MS
      ? "stale"
      : normalizedStatus;
  return { ...event, status };
}

function hasCompleteReport(reservation: VisualAttemptReservation): boolean {
  return (
    typeof reservation.reportArtifactId === "string" &&
    reservation.reportArtifactId.length > 0 &&
    typeof reservation.reportDigest === "string" &&
    reservation.reportDigest.length > 0
  );
}

function latest(candidates: IndexedReservation[]): IndexedReservation | undefined {
  return candidates.reduce<IndexedReservation | undefined>(
    (current, candidate) =>
      current === undefined || isLater(candidate.reservation, candidate.index, current)
        ? candidate
        : current,
    undefined,
  );
}

function isLater(
  reservation: VisualAttemptReservation,
  index: number,
  current: IndexedReservation,
): boolean {
  const timestamp = Date.parse(reservation.updatedAt);
  const currentTimestamp = Date.parse(current.reservation.updatedAt);
  if (timestamp !== currentTimestamp) return timestamp > currentTimestamp;
  return index > current.index;
}
