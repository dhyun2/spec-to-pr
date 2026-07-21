import { PNG } from "pngjs";

export type PngImage = {
  width: number;
  height: number;
  data: Buffer;
};

export function decodePng(content: Buffer): PngImage {
  return PNG.sync.read(content);
}

export function createPng(width: number, height: number): PngImage {
  return new PNG({ width, height });
}

export function encodePng(image: PngImage): Buffer {
  return PNG.sync.write(image as PNG);
}
