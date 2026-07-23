import type { VisualSize } from "../figma/figma-capture-contract.js";
import { VisualSizeSchema } from "../figma/figma-capture-contract.js";
import { createPng, encodePng } from "./png-codec.js";
import { decodeBoundedPng, MAX_VISUAL_PIXEL_COUNT } from "./png-decoder.js";

export async function normalizeVisualPng(input: {
  content: Buffer;
  sourceSize: VisualSize;
  logicalSize: VisualSize;
  colorSpace: "srgb";
  role: string;
}): Promise<{
  content: Buffer;
  width: number;
  height: number;
  version: "visual-normalizer-v1";
}> {
  const sourceSize = VisualSizeSchema.parse(input.sourceSize);
  const logicalSize = VisualSizeSchema.parse(input.logicalSize);
  if (input.colorSpace !== "srgb") {
    throw new Error("FIGMA_CAPTURE_GEOMETRY_INVALID: visual normalization requires sRGB");
  }
  if (logicalSize.width > Math.floor(MAX_VISUAL_PIXEL_COUNT / logicalSize.height)) {
    throw new Error(
      `VISUAL_PIXEL_LIMIT: normalized ${input.role} ${logicalSize.width}x${logicalSize.height} exceeds ${MAX_VISUAL_PIXEL_COUNT} pixels`,
    );
  }

  const source = await decodeBoundedPng(input.content, input.role);
  if (source.width !== sourceSize.width || source.height !== sourceSize.height) {
    throw new Error(
      `FIGMA_CAPTURE_GEOMETRY_INVALID: decoded ${input.role} is ${source.width}x${source.height}, expected ${sourceSize.width}x${sourceSize.height}`,
    );
  }

  const output = createPng(logicalSize.width, logicalSize.height);
  for (let y = 0; y < logicalSize.height; y += 1) {
    for (let x = 0; x < logicalSize.width; x += 1) {
      const sourceX = ((x + 0.5) * source.width) / logicalSize.width - 0.5;
      const sourceY = ((y + 0.5) * source.height) / logicalSize.height - 0.5;
      const left = clamp(Math.floor(sourceX), 0, source.width - 1);
      const top = clamp(Math.floor(sourceY), 0, source.height - 1);
      const right = Math.min(left + 1, source.width - 1);
      const bottom = Math.min(top + 1, source.height - 1);
      const weightX = clamp(sourceX - Math.floor(sourceX), 0, 1);
      const weightY = clamp(sourceY - Math.floor(sourceY), 0, 1);
      const outputOffset = (y * logicalSize.width + x) * 4;

      for (let channel = 0; channel < 3; channel += 1) {
        const topValue = mix(
          opaqueChannel(source.data, source.width, left, top, channel),
          opaqueChannel(source.data, source.width, right, top, channel),
          weightX,
        );
        const bottomValue = mix(
          opaqueChannel(source.data, source.width, left, bottom, channel),
          opaqueChannel(source.data, source.width, right, bottom, channel),
          weightX,
        );
        output.data[outputOffset + channel] = Math.round(mix(topValue, bottomValue, weightY));
      }
      output.data[outputOffset + 3] = 255;
    }
  }

  return {
    content: encodePng(output),
    width: logicalSize.width,
    height: logicalSize.height,
    version: "visual-normalizer-v1",
  };
}

function opaqueChannel(data: Buffer, width: number, x: number, y: number, channel: number): number {
  const offset = (y * width + x) * 4;
  const alpha = data[offset + 3]! / 255;
  return data[offset + channel]! * alpha + 255 * (1 - alpha);
}

function mix(left: number, right: number, amount: number): number {
  return left * (1 - amount) + right * amount;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
