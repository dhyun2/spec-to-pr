export function encodeGitLabProjectId(projectPathOrId: string): string {
  if (/^\d+$/.test(projectPathOrId)) {
    return projectPathOrId;
  }

  return encodeURIComponent(projectPathOrId);
}
