export function redactSecrets(input: string): string {
  return input
    .replace(/ghp_[A-Za-z0-9_]+/g, "[REDACTED_GITHUB_TOKEN]")
    .replace(/github_pat_[A-Za-z0-9_]+/g, "[REDACTED_GITHUB_TOKEN]")
    .replace(/glpat-[A-Za-z0-9_-]+/g, "[REDACTED_GITLAB_TOKEN]")
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [REDACTED]")
    .replace(/PRIVATE-TOKEN:\s*[A-Za-z0-9._~-]+/gi, "PRIVATE-TOKEN: [REDACTED]");
}
