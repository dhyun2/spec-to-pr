import { createHash } from "node:crypto";

import { Sha256DigestSchema, type Sha256Digest } from "../runtime/scalars.js";

export function sha256Digest(input: Buffer | string): Sha256Digest {
  const hex = createHash("sha256").update(input).digest("hex");

  return Sha256DigestSchema.parse(`sha256:${hex}`);
}

export function digestHex(digest: Sha256Digest): string {
  return digest.replace(/^sha256:/, "");
}

export function digestPathSegments(digest: Sha256Digest): {
  prefix: string;
  hex: string;
} {
  const hex = digestHex(digest);

  return {
    prefix: hex.slice(0, 2),
    hex,
  };
}
