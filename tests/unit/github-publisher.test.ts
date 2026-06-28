import { describe, expect, it, vi } from "vitest";

import { GitHubPublisherAdapter } from "../../src/publisher/github-publisher.js";
import type { PublishTarget, ReviewRequestPayload } from "../../src/publisher/index.js";

describe("GitHubPublisherAdapter", () => {
  it("creates draft pull requests with report body", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          html_url: "https://github.com/acme/spec-to-pr/pull/123",
          number: 123,
          id: 456,
          draft: true,
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const adapter = new GitHubPublisherAdapter(fetchMock);

    const result = await adapter.create({
      target: githubTarget(),
      payload: payload(),
      token: "ghp_example",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/repos/acme/spec-to-pr/pulls",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer ghp_example",
        }),
      }),
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]!.body))).toMatchObject({
      title: "Spec to PR",
      body: "# Summary",
      draft: true,
    });
    expect(result).toMatchObject({
      host: "github",
      number: "123",
      draft: true,
      created: true,
    });
  });
});

function githubTarget(): PublishTarget {
  return {
    host: "github",
    webBaseUrl: "https://github.com",
    apiBaseUrl: "https://api.github.com",
    owner: "acme",
    repo: "spec-to-pr",
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
