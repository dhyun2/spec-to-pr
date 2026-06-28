import { describe, expect, it, vi } from "vitest";

import { GitLabPublisherAdapter } from "../../src/publisher/gitlab-publisher.js";
import type { PublishTarget, ReviewRequestPayload } from "../../src/publisher/index.js";

describe("GitLabPublisherAdapter", () => {
  it("creates draft merge requests with Draft title prefix", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        web_url: "https://gitlab.com/acme/spec-to-pr/-/merge_requests/7",
        iid: 7,
        id: 70,
        title: "Draft: Spec to PR",
      }),
    );
    const adapter = new GitLabPublisherAdapter(fetchMock);

    const result = await adapter.create({
      target: gitlabTarget(),
      payload: payload(),
      token: "glpat-example",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://gitlab.com/api/v4/projects/acme%2Fplatform%2Fspec-to-pr/merge_requests",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "PRIVATE-TOKEN": "glpat-example",
        }),
      }),
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]!.body))).toMatchObject({
      title: "Draft: Spec to PR",
      description: "# Summary",
      source_branch: "spec-to-pr/run-1",
    });
    expect(result).toMatchObject({
      host: "gitlab",
      number: "7",
      draft: true,
      created: true,
    });
  });
});

function gitlabTarget(): PublishTarget {
  return {
    host: "gitlab",
    webBaseUrl: "https://gitlab.com",
    apiBaseUrl: "https://gitlab.com/api/v4",
    projectPath: "acme/platform/spec-to-pr",
  };
}

function payload(): ReviewRequestPayload {
  return {
    runId: "run_11111111111111111111111111111111",
    title: "Spec to PR",
    body: "# Summary",
    sourceBranch: "spec-to-pr/run-1",
    targetBranch: "main",
    mode: "draft",
    labels: ["spec-to-pr"],
    reviewers: [],
    assignees: [],
    reportArtifactId: "art_11111111111111111111111111111111",
  };
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: {
      "content-type": "application/json",
    },
  });
}
