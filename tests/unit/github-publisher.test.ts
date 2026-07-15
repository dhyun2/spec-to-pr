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
    const controller = new AbortController();

    const result = await adapter.create({
      target: githubTarget(),
      payload: payload(),
      token: "ghp_example",
      signal: controller.signal,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/repos/acme/spec-to-pr/pulls",
      expect.objectContaining({
        method: "POST",
        signal: controller.signal,
        headers: expect.objectContaining({
          Authorization: "Bearer ghp_example",
        }),
      }),
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]!.body))).toMatchObject({
      title: "SpecToPR",
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

  it("creates blocked drafts and synchronizes both required labels", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          html_url: "https://github.com/acme/spec-to-pr/pull/124",
          number: 124,
          id: 457,
          draft: true,
        }),
      )
      .mockResolvedValueOnce(jsonResponse([{ name: "spec-to-pr" }]));
    const adapter = new GitHubPublisherAdapter(fetchMock);

    await adapter.create({
      target: githubTarget(),
      payload: blockedPayload(),
      token: "ghp_example",
    });

    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]!.body))).toMatchObject({
      title: "[Blocked] SpecToPR Run run_11111111111111111111111111111111",
      draft: true,
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://api.github.com/repos/acme/spec-to-pr/issues/124/labels",
      expect.objectContaining({ method: "POST" }),
    );
    expect(JSON.parse(String(fetchMock.mock.calls[1]![1]!.body))).toEqual({
      labels: ["spec-to-pr", "spec-to-pr:blocked"],
    });
  });

  it("reports the created draft when blocked-label synchronization fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          html_url: "https://github.com/acme/spec-to-pr/pull/125",
          number: 125,
          id: 458,
          draft: true,
        }),
      )
      .mockResolvedValueOnce(new Response("label rejected", { status: 422 }));
    const adapter = new GitHubPublisherAdapter(fetchMock);

    const error = await adapter
      .create({
        target: githubTarget(),
        payload: blockedPayload(),
        token: "ghp_example",
      })
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      name: "ReviewRequestSynchronizationError",
      phase: "labels",
      request: {
        number: "125",
        draft: true,
        created: true,
        updated: false,
      },
    });
    expect(String((error as Error).message)).toMatch(/labels.*422.*label rejected/i);
  });

  it("updates pull request title and body and replaces issue labels", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          html_url: "https://github.com/acme/spec-to-pr/pull/123",
          number: 123,
          id: 456,
          draft: true,
          head: { ref: "spec-to-pr/run-1" },
          base: { ref: "main" },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ labels: [{ name: "spec-to-pr" }] }));
    const adapter = new GitHubPublisherAdapter(fetchMock);

    const result = await adapter.update({
      target: githubTarget(),
      requestNumber: "123",
      update: {
        title: "SpecToPR ready",
        body: "# Ready report",
        labels: ["spec-to-pr"],
      },
      token: "ghp_example",
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://api.github.com/repos/acme/spec-to-pr/pulls/123",
      expect.objectContaining({ method: "PATCH" }),
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]!.body))).toEqual({
      title: "SpecToPR ready",
      body: "# Ready report",
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://api.github.com/repos/acme/spec-to-pr/issues/123/labels",
      expect.objectContaining({ method: "PUT" }),
    );
    expect(JSON.parse(String(fetchMock.mock.calls[1]![1]!.body))).toEqual({
      labels: ["spec-to-pr"],
    });
    expect(result).toMatchObject({ number: "123", draft: true, updated: true });
  });

  it("reports a patched draft on label failure and completes labels on retry", async () => {
    const pull = {
      html_url: "https://github.com/acme/spec-to-pr/pull/123",
      number: 123,
      id: 456,
      draft: true,
      head: { ref: "spec-to-pr/run-1" },
      base: { ref: "main" },
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(pull))
      .mockResolvedValueOnce(new Response("labels unavailable", { status: 503 }))
      .mockResolvedValueOnce(jsonResponse(pull))
      .mockResolvedValueOnce(jsonResponse([{ name: "spec-to-pr" }]));
    const adapter = new GitHubPublisherAdapter(fetchMock);
    const input = {
      target: githubTarget(),
      requestNumber: "123",
      update: {
        title: "SpecToPR ready",
        body: "# Ready report",
        labels: ["spec-to-pr"],
      },
      token: "ghp_example",
    };

    const error = await adapter.update(input).catch((caught: unknown) => caught);
    expect(error).toMatchObject({
      name: "ReviewRequestSynchronizationError",
      phase: "labels",
      request: { number: "123", draft: true, created: false, updated: true },
    });

    await expect(adapter.update(input)).resolves.toMatchObject({
      number: "123",
      draft: true,
      updated: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(JSON.parse(String(fetchMock.mock.calls[3]![1]!.body))).toEqual({
      labels: ["spec-to-pr"],
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
    title: "SpecToPR",
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

function blockedPayload(): ReviewRequestPayload {
  return {
    ...payload(),
    title: "[Blocked] SpecToPR Run run_11111111111111111111111111111111",
    body: "# Blocked diagnostic",
    labels: ["spec-to-pr", "spec-to-pr:blocked"],
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
