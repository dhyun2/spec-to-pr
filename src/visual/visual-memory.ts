export type VisualMemoryCheckpoint = {
  stage: string;
  managedBytes: number;
  rssBytes: number;
  ownership: Record<string, number>;
};

export type VisualMemoryCheckpointSink = (checkpoint: VisualMemoryCheckpoint) => void;

export function emitVisualMemoryCheckpoint(
  sink: VisualMemoryCheckpointSink | undefined,
  stage: string,
  ownership: Record<string, number>,
): void {
  if (sink === undefined) return;
  sink({
    stage,
    managedBytes: Object.values(ownership).reduce((total, bytes) => total + bytes, 0),
    rssBytes: process.memoryUsage().rss,
    ownership,
  });
}
