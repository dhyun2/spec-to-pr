import type { VisualMaskRegion } from "./visual-model.js";

export function isMaskedPixel(input: {
  x: number;
  y: number;
  masks: VisualMaskRegion[];
}): boolean {
  return input.masks.some(
    (mask) =>
      input.x >= mask.x &&
      input.x < mask.x + mask.width &&
      input.y >= mask.y &&
      input.y < mask.y + mask.height,
  );
}
