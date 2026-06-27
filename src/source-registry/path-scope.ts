import { realpath, stat } from "node:fs/promises";
import path from "node:path";

import { RelativePathSchema, type RelativePath } from "../runtime/scalars.js";

export type ScopedFilePath = {
  projectRoot: string;
  absolutePath: string;
  relativePath: RelativePath;
};

export async function resolveFileInsideRoot(input: {
  projectRoot: string;
  filePath: string;
}): Promise<ScopedFilePath> {
  const projectRoot = await realpath(input.projectRoot);
  const candidate = path.resolve(projectRoot, input.filePath);
  const absolutePath = await realpath(candidate);
  const relative = path.relative(projectRoot, absolutePath);

  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`File is outside project root: ${input.filePath}`);
  }

  const metadata = await stat(absolutePath);

  if (!metadata.isFile()) {
    throw new Error(`Source path is not a file: ${input.filePath}`);
  }

  return {
    projectRoot,
    absolutePath,
    relativePath: RelativePathSchema.parse(toPosixPath(relative)),
  };
}

function toPosixPath(value: string): string {
  return value.split(path.sep).join("/");
}
