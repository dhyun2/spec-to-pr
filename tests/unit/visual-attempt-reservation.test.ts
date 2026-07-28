import { describe, expect, it } from "vitest";

import {
  nextCommittedVisualAttempt,
  reduceVisualReservations,
  type VisualAttemptReservation,
} from "../../src/workflow/visual-attempt-reservation.js";

const now = "2026-07-28T10:30:00.000Z";

function reservation(overrides: Partial<VisualAttemptReservation> = {}): VisualAttemptReservation {
  return {
    submissionIdentity: "submission-1",
    attempt: 1,
    status: "in-progress",
    ownerToken: "owner-1",
    reservedAt: "2026-07-28T10:29:00.000Z",
    updatedAt: "2026-07-28T10:29:00.000Z",
    ...overrides,
  };
}

function committed(
  attempt: 1 | 2 | 3,
  overrides: Partial<VisualAttemptReservation> = {},
): VisualAttemptReservation {
  return reservation({
    submissionIdentity: `submission-${String(attempt)}`,
    attempt,
    status: "committed",
    ownerToken: `owner-${String(attempt)}`,
    reportArtifactId: `artifact-${String(attempt)}`,
    reportDigest: `sha256:${String(attempt).repeat(64)}`,
    ...overrides,
  });
}

describe("visual attempt reservations", () => {
  it("reuses attempt one after aborted and stale reservations", () => {
    expect(
      nextCommittedVisualAttempt(
        reduceVisualReservations(
          [
            reservation({ status: "aborted", updatedAt: "2026-07-28T10:01:00.000Z" }),
            reservation({
              submissionIdentity: "submission-2",
              ownerToken: "owner-2",
              status: "in-progress",
              reservedAt: "2026-07-28T10:00:00.000Z",
              updatedAt: "2026-07-28T10:00:00.000Z",
            }),
          ],
          now,
        ),
      ),
    ).toBe(1);
  });

  it("counts only a committed event with a complete numeric report", () => {
    const summary = reduceVisualReservations(
      [
        committed(1),
        reservation({
          submissionIdentity: "submission-2",
          attempt: 2,
          status: "aborted",
          ownerToken: "owner-2",
        }),
        reservation({
          submissionIdentity: "submission-3",
          attempt: 2,
          status: "committed",
          ownerToken: "owner-3",
          reportArtifactId: "artifact-2",
        }),
      ],
      now,
    );

    expect(summary.committed.map(({ attempt }) => attempt)).toEqual([1]);
    expect(nextCommittedVisualAttempt(summary)).toBe(2);
  });

  it("normalizes legacy completed and failed events", () => {
    const summary = reduceVisualReservations(
      [
        {
          ...committed(1),
          status: "completed",
        },
        {
          ...reservation({
            submissionIdentity: "submission-2",
            attempt: 2,
            ownerToken: "owner-2",
          }),
          status: "failed",
        },
      ],
      now,
    );

    expect(summary.committed.map(({ status, attempt }) => ({ status, attempt }))).toEqual([
      { status: "committed", attempt: 1 },
    ]);
    expect(nextCommittedVisualAttempt(summary)).toBe(2);
  });

  it("collapses lifecycle events by owner token and submission identity", () => {
    const summary = reduceVisualReservations(
      [
        reservation(),
        committed(1, { updatedAt: "2026-07-28T10:29:30.000Z" }),
        committed(1, {
          ownerToken: "owner-replayed",
          updatedAt: "2026-07-28T10:29:45.000Z",
        }),
      ],
      now,
    );

    expect(summary.committed).toHaveLength(1);
    expect(summary.committed[0]).toMatchObject({
      submissionIdentity: "submission-1",
      attempt: 1,
      status: "committed",
      ownerToken: "owner-replayed",
    });
  });

  it("counts a concurrently duplicated attempt number once", () => {
    const summary = reduceVisualReservations(
      [
        committed(1),
        committed(1, {
          submissionIdentity: "submission-concurrent",
          ownerToken: "owner-concurrent",
          reportArtifactId: "artifact-concurrent",
          reportDigest: `sha256:${"a".repeat(64)}`,
        }),
      ],
      now,
    );

    expect(summary.committed).toHaveLength(1);
    expect(nextCommittedVisualAttempt(summary)).toBe(2);
  });

  it("requires committed attempt numbers to be contiguous", () => {
    const summary = reduceVisualReservations([committed(2), committed(3)], now);

    expect(summary.committed).toEqual([]);
    expect(nextCommittedVisualAttempt(summary)).toBe(1);
  });

  it("identifies fresh work as active and expired work as recoverable", () => {
    const fresh = reservation();
    const expired = reservation({
      submissionIdentity: "submission-expired",
      ownerToken: "owner-expired",
      reservedAt: "2026-07-28T10:00:00.000Z",
      updatedAt: "2026-07-28T10:00:00.000Z",
    });
    const summary = reduceVisualReservations([expired, fresh], now);

    expect(summary.active).toMatchObject({ ownerToken: "owner-1", status: "in-progress" });
    expect(summary.recoverable).toMatchObject({ ownerToken: "owner-expired", status: "stale" });
  });

  it("caps the next committed attempt at three", () => {
    expect(
      nextCommittedVisualAttempt(
        reduceVisualReservations([committed(1), committed(2), committed(3)], now),
      ),
    ).toBeUndefined();
  });
});
