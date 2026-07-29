export function runConcurrentOrdered<T>(tasks: readonly (() => Promise<T>)[]): Promise<T[]>;
