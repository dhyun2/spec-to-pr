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
        title: "Draft: SpecToPR",
      }),
    );
    const adapter = new GitLabPublisherAdapter(fetchMock);
    const controller = new AbortController();

    const result = await adapter.create({
      target: gitlabTarget(),
      payload: payload(),
      token: "glpat-example",
      signal: controller.signal,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://gitlab.com/api/v4/projects/acme%2Fplatform%2Fspec-to-pr/merge_requests",
      expect.objectContaining({
        method: "POST",
        signal: controller.signal,
        headers: expect.objectContaining({
          "PRIVATE-TOKEN": "glpat-example",
        }),
      }),
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]!.body))).toMatchObject({
      title: "Draft: SpecToPR",
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

  it("updates draft merge request title, description, and labels", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        web_url: "https://gitlab.com/acme/spec-to-pr/-/merge_requests/7",
        iid: 7,
        id: 70,
        title: "Draft: [Blocked] SpecToPR Run run_11111111111111111111111111111111",
        source_branch: "spec-to-pr/run-1",
        target_branch: "main",
      }),
    );
    const adapter = new GitLabPublisherAdapter(fetchMock);

    const result = await adapter.update({
      target: gitlabTarget(),
      requestNumber: "7",
      update: {
        title: "[Blocked] SpecToPR Run run_11111111111111111111111111111111",
        body: "# Blocked diagnostic",
        labels: ["spec-to-pr", "spec-to-pr:blocked"],
      },
      token: "glpat-example",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://gitlab.com/api/v4/projects/acme%2Fplatform%2Fspec-to-pr/merge_requests/7",
      expect.objectContaining({ method: "PUT" }),
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]!.body))).toEqual({
      title: "Draft: [Blocked] SpecToPR Run run_11111111111111111111111111111111",
      description: "# Blocked diagnostic",
      labels: "spec-to-pr,spec-to-pr:blocked",
    });
    expect(result).toMatchObject({ number: "7", draft: true, updated: true });
  });

  it("recovers a blocked draft by replacing labels with the ready label set", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        web_url: "https://gitlab.com/acme/spec-to-pr/-/merge_requests/7",
        iid: 7,
        id: 70,
        title: "Draft: spec-to-pr evidence report for run_11111111111111111111111111111111",
        source_branch: "spec-to-pr/run-1",
        target_branch: "main",
      }),
    );
    const adapter = new GitLabPublisherAdapter(fetchMock);

    await adapter.update({
      target: gitlabTarget(),
      requestNumber: "7",
      update: {
        title: "spec-to-pr evidence report for run_11111111111111111111111111111111",
        body: "# Ready report",
        labels: ["spec-to-pr"],
      },
      token: "glpat-example",
    });

    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]!.body))).toEqual({
      title: "Draft: spec-to-pr evidence report for run_11111111111111111111111111111111",
      description: "# Ready report",
      labels: "spec-to-pr",
    });
  });

  it("uploads visual evidence as project-relative uploads (no instance-root prefix)", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        // Real GitLab responses include the project path in full_path.
        url: "/uploads/abc123/figma.png",
        full_path: "/acme/platform/spec-to-pr/uploads/abc123/figma.png",
        markdown: "![figma.png](/uploads/abc123/figma.png)",
      }),
    );
    const adapter = new GitLabPublisherAdapter(fetchMock);

    const result = await adapter.publishAssets({
      target: gitlabTarget(),
      payload: payload(),
      token: "glpat-example",
      assets: [
        {
          artifactId: "art_22222222222222222222222222222222",
          targetId: "home",
          role: "figma",
          label: "Figma",
          filename: "figma.png",
          mediaType: "image/png",
          content: Buffer.from("png"),
        },
      ],
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://gitlab.com/api/v4/projects/acme%2Fplatform%2Fspec-to-pr/uploads",
      expect.objectContaining({
        method: "POST",
        body: expect.any(FormData),
        headers: expect.not.objectContaining({
          "Content-Type": "application/json",
        }),
      }),
    );
    // Keeps the project-scoped RELATIVE path; never prefixes the instance root
    // (which would drop the project path and 404).
    expect(result).toEqual([
      {
        artifactId: "art_22222222222222222222222222222222",
        targetId: "home",
        role: "figma",
        label: "Figma",
        url: "/acme/platform/spec-to-pr/uploads/abc123/figma.png",
        embeddable: true,
      },
    ]);
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

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: {
      "content-type": "application/json",
    },
  });
}
