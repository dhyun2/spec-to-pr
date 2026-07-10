import { FocusCheckSchema } from "./accessibility-model.js";
import type { AccessibilityCheckStatus, FocusCheck } from "./accessibility-model.js";

export function createFocusCheck(input: {
  targetId: string;
  status: AccessibilityCheckStatus;
  focusTrapWorks?: boolean;
  focusRestoreWorks?: boolean;
  initialFocusSelector?: string;
  finalFocusSelector?: string;
  reason?: string;
}): FocusCheck {
  return FocusCheckSchema.parse({
    id: `focus-${input.targetId}`,
    targetId: input.targetId,
    status: input.status,
    ...(input.focusTrapWorks === undefined ? {} : { focusTrapWorks: input.focusTrapWorks }),
    ...(input.focusRestoreWorks === undefined
      ? {}
      : { focusRestoreWorks: input.focusRestoreWorks }),
    ...(input.initialFocusSelector === undefined
      ? {}
      : { initialFocusSelector: input.initialFocusSelector }),
    ...(input.finalFocusSelector === undefined
      ? {}
      : { finalFocusSelector: input.finalFocusSelector }),
    ...(input.reason === undefined ? {} : { reason: input.reason }),
  });
}
