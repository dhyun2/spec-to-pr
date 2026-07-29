/**
 * Start read-only Case 4 work together while preserving the declared output
 * order. Each task owns its output path and must not mutate shared fixtures.
 */
export function runConcurrentOrdered(tasks) {
  return Promise.all(tasks.map((task) => task()));
}
