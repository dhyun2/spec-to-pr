for (const name of ["SPEC_TO_PR_GIT_HOST", "SPEC_TO_PR_WEB_BASE_URL", "SPEC_TO_PR_API_BASE_URL"]) {
  delete process.env[name];
}
