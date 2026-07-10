import { KeyboardCheckSchema } from "./accessibility-model.js";
import type { AccessibilityCheckStatus, KeyboardCheck } from "./accessibility-model.js";

export function createKeyboardCheck(input: {
  targetId: string;
  status: AccessibilityCheckStatus;
  tabStops?: number;
  escapeWorks?: boolean;
  enterSpaceWorks?: boolean;
  reason?: string;
}): KeyboardCheck {
  return KeyboardCheckSchema.parse({
    id: `keyboard-${input.targetId}`,
    targetId: input.targetId,
    status: input.status,
    ...(input.tabStops === undefined ? {} : { tabStops: input.tabStops }),
    ...(input.escapeWorks === undefined ? {} : { escapeWorks: input.escapeWorks }),
    ...(input.enterSpaceWorks === undefined ? {} : { enterSpaceWorks: input.enterSpaceWorks }),
    ...(input.reason === undefined ? {} : { reason: input.reason }),
  });
}
