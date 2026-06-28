import { describe, expect, it } from "vitest";

import { createFocusCheck } from "../../src/accessibility/focus-checks.js";
import { createKeyboardCheck } from "../../src/accessibility/keyboard-smoke.js";

describe("keyboard and focus check contracts", () => {
  it("creates not-run keyboard and focus checks with explicit reasons", () => {
    const keyboard = createKeyboardCheck({
      targetId: "reservation-list",
      status: "not-run",
      reason: "Keyboard runner is not wired.",
    });
    const focus = createFocusCheck({
      targetId: "reservation-list",
      status: "not-run",
      reason: "Focus runner is not wired.",
    });

    expect(keyboard).toMatchObject({
      id: "keyboard-reservation-list",
      status: "not-run",
    });
    expect(focus).toMatchObject({
      id: "focus-reservation-list",
      status: "not-run",
    });
  });
});
