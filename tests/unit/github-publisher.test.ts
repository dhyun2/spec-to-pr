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

  it("uploads visual evidence and pins public-repo URLs to the commit SHA", async () => {
    const fetchMock = vi
      .fn()
      // repo visibility check (public)
      .mockResolvedValueOnce(jsonResponse({ private: false }))
      // findContentSha -> not found
      .mockResolvedValueOnce(new Response("not found", { status: 404 }))
      // PUT upload -> returns commit sha
      .mockResolvedValueOnce(
        jsonResponse({
          content: {
            html_url:
              "https://github.com/acme/spec-to-pr/blob/spec-to-pr/run-1/.spec-to-pr/visual-assets/x/figma.png",
          },
          commit: { sha: "abc123def456" },
        }),
      );
    const adapter = new GitHubPublisherAdapter(fetchMock);

    const result = await adapter.publishAssets({
      target: githubTarget(),
      payload: payload(),
      token: "ghp_example",
      assets: [asset()],
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://api.github.com/repos/acme/spec-to-pr",
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining(
        "/repos/acme/spec-to-pr/contents/.spec-to-pr/visual-assets/run_11111111111111111111111111111111/home/figma.png",
      ),
      expect.objectContaining({ method: "PUT" }),
    );
    expect(result).toEqual([
      {
        artifactId: "art_22222222222222222222222222222222",
        targetId: "home",
        role: "figma",
        label: "Figma",
        url: "https://raw.githubusercontent.com/acme/spec-to-pr/abc123def456/.spec-to-pr/visual-assets/run_11111111111111111111111111111111/home/figma.png",
        embeddable: true,
      },
    ]);
  });

  it("falls back to a non-embeddable blob link for private repos", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ private: true }))
      .mockResolvedValueOnce(new Response("not found", { status: 404 }))
      .mockResolvedValueOnce(
        jsonResponse({
          content: {
            html_url:
              "https://github.com/acme/spec-to-pr/blob/spec-to-pr/run-1/.spec-to-pr/visual-assets/x/figma.png",
          },
          commit: { sha: "abc123def456" },
        }),
      );
    const adapter = new GitHubPublisherAdapter(fetchMock);

    const result = await adapter.publishAssets({
      target: githubTarget(),
      payload: payload(),
      token: "ghp_example",
      assets: [asset()],
    });

    expect(result[0]).toMatchObject({
      embeddable: false,
      url: "https://github.com/acme/spec-to-pr/blob/spec-to-pr/run-1/.spec-to-pr/visual-assets/x/figma.png",
    });
  });
});

function asset() {
  return {
    artifactId: "art_22222222222222222222222222222222",
    targetId: "home",
    role: "figma" as const,
    label: "Figma",
    filename: "figma.png",
    mediaType: "image/png",
    content: Buffer.from("png"),
  };
}

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
