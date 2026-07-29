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
      // managed evidence ref
      .mockResolvedValueOnce(jsonResponse(evidenceRef()))
      // findContentSha -> not found
      .mockResolvedValueOnce(new Response("not found", { status: 404 }))
      // PUT upload -> returns commit sha
      .mockResolvedValueOnce(
        jsonResponse({
          content: {
            sha: "f".repeat(40),
            html_url:
              "https://github.com/acme/spec-to-pr/blob/spec-to-pr/run-1/.spec-to-pr/visual-assets/x/figma.png",
          },
          commit: { sha: EVIDENCE_COMMIT },
        }),
      );
    const adapter = new GitHubPublisherAdapter(fetchMock);

    const result = await adapter.publishAssets({
      target: githubTarget(),
      payload: payload(),
      token: "ghp_example",
      maxConcurrency: 3,
      assets: [asset()],
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://api.github.com/repos/acme/spec-to-pr",
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      expect.stringContaining(
        `/repos/acme/spec-to-pr/contents/.spec-to-pr/visual-assets/run_11111111111111111111111111111111/${PACKET_ID}/home/art_22222222222222222222222222222222/figma.png`,
      ),
      expect.objectContaining({ method: "PUT" }),
    );
    expect(result).toEqual([
      {
        status: "published",
        asset: {
          artifactId: "art_22222222222222222222222222222222",
          artifactDigest: `sha256:${"d".repeat(64)}`,
          targetId: "home",
          role: "figma",
          label: "Figma",
          url: `https://raw.githubusercontent.com/acme/spec-to-pr/${EVIDENCE_COMMIT}/.spec-to-pr/visual-assets/run_11111111111111111111111111111111/${PACKET_ID}/home/art_22222222222222222222222222222222/figma.png`,
          embeddable: true,
        },
      },
    ]);
  });

  it("uploads ready evidence on the single managed ref without moving the reviewed source branch", async () => {
    const reviewedHead = REVIEWED_HEAD;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ private: false }))
      .mockResolvedValueOnce(new Response("missing ref", { status: 404 }))
      .mockResolvedValueOnce(jsonResponse(evidenceRef(reviewedHead), 201))
      .mockResolvedValueOnce(new Response("missing asset", { status: 404 }))
      .mockResolvedValueOnce(
        jsonResponse({ content: uploadedContent(), commit: { sha: EVIDENCE_COMMIT } }),
      );
    const adapter = new GitHubPublisherAdapter(fetchMock);

    await adapter.publishAssets({
      target: githubTarget(),
      payload: { ...payload(), headSha: reviewedHead },
      token: "ghp_example",
      maxConcurrency: 3,
      assets: [asset()],
    });

    expect(JSON.parse(String(fetchMock.mock.calls[2]![1]!.body))).toEqual({
      ref: "refs/heads/spec-to-pr/evidence",
      sha: reviewedHead,
    });
    const uploadBody = JSON.parse(String(fetchMock.mock.calls[4]![1]!.body)) as Record<
      string,
      unknown
    >;
    expect(uploadBody["branch"]).toBe("spec-to-pr/evidence");
    expect(uploadBody["branch"]).not.toBe("spec-to-pr/run-1");
  });

  it("falls back to a non-embeddable blob link for private repos", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ private: true }))
      .mockResolvedValueOnce(jsonResponse(evidenceRef()))
      .mockResolvedValueOnce(new Response("not found", { status: 404 }))
      .mockResolvedValueOnce(
        jsonResponse({
          content: {
            sha: "f".repeat(40),
            html_url:
              "https://github.com/acme/spec-to-pr/blob/spec-to-pr/run-1/.spec-to-pr/visual-assets/x/figma.png",
          },
          commit: { sha: EVIDENCE_COMMIT },
        }),
      );
    const adapter = new GitHubPublisherAdapter(fetchMock);

    const result = await adapter.publishAssets({
      target: githubTarget(),
      payload: payload(),
      token: "ghp_example",
      maxConcurrency: 3,
      assets: [asset()],
    });

    expect(result[0]).toMatchObject({
      status: "published",
      asset: {
        embeddable: false,
        url: `https://github.com/acme/spec-to-pr/blob/${EVIDENCE_COMMIT}/.spec-to-pr/visual-assets/run_11111111111111111111111111111111/${PACKET_ID}/home/art_22222222222222222222222222222222/figma.png`,
      },
    });
  });

  it("keeps public GitHub Enterprise evidence on the exact configured host", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ private: false }))
      .mockResolvedValueOnce(jsonResponse(evidenceRef()))
      .mockResolvedValueOnce(new Response("not found", { status: 404 }))
      .mockResolvedValueOnce(
        jsonResponse({
          content: { sha: "f".repeat(40) },
          commit: { sha: EVIDENCE_COMMIT },
        }),
      );
    const adapter = new GitHubPublisherAdapter(fetchMock);
    const enterpriseTarget: PublishTarget = {
      ...githubTarget(),
      webBaseUrl: "https://github.corp.example",
      apiBaseUrl: "https://github.corp.example/api/v3",
    };

    const result = await adapter.publishAssets({
      target: enterpriseTarget,
      payload: payload(),
      token: "ghp_example",
      maxConcurrency: 3,
      assets: [asset()],
    });

    expect(result[0]).toMatchObject({
      status: "published",
      asset: {
        embeddable: false,
        url: `https://github.corp.example/acme/spec-to-pr/blob/${EVIDENCE_COMMIT}/.spec-to-pr/visual-assets/run_11111111111111111111111111111111/${PACKET_ID}/home/art_22222222222222222222222222222222/figma.png`,
      },
    });
    expect(JSON.stringify(result)).not.toContain("raw.githubusercontent.com");
  });

  it("reuses the same managed branch across runs", async () => {
    const fetchMock = vi.fn();
    for (let index = 0; index < 2; index += 1) {
      fetchMock
        .mockResolvedValueOnce(jsonResponse({ private: false }))
        .mockResolvedValueOnce(jsonResponse(evidenceRef()))
        .mockResolvedValueOnce(new Response("not found", { status: 404 }))
        .mockResolvedValueOnce(
          jsonResponse({ content: uploadedContent(), commit: { sha: EVIDENCE_COMMIT } }),
        );
    }
    const adapter = new GitHubPublisherAdapter(fetchMock);

    await adapter.publishAssets({
      target: githubTarget(),
      payload: payload(),
      token: "ghp_example",
      maxConcurrency: 3,
      assets: [asset()],
    });
    await adapter.publishAssets({
      target: githubTarget(),
      payload: { ...payload(), runId: `run_${"3".repeat(32)}`, sourceBranch: "codex/another" },
      token: "ghp_example",
      maxConcurrency: 3,
      assets: [asset()],
    });

    const uploadBodies = fetchMock.mock.calls
      .filter((call) => call[1]?.method === "PUT")
      .map((call) => JSON.parse(String(call[1]?.body)) as Record<string, unknown>);
    expect(uploadBodies).toHaveLength(2);
    expect(uploadBodies.map((body) => body["branch"])).toEqual([
      "spec-to-pr/evidence",
      "spec-to-pr/evidence",
    ]);
    expect(JSON.stringify(uploadBodies)).not.toContain("codex/another");
  });

  it.each([
    { ref: "refs/tags/spec-to-pr/evidence", object: { type: "commit", sha: REVIEWED_HEAD } },
    { ref: "refs/heads/spec-to-pr/evidence", object: { type: "tag", sha: REVIEWED_HEAD } },
    { ref: "refs/heads/spec-to-pr/evidence", object: { type: "commit", sha: "invalid" } },
  ])("settles malformed or non-commit managed refs for every input", async (invalidRef) => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ private: false }))
      .mockResolvedValueOnce(jsonResponse(invalidRef));
    const adapter = new GitHubPublisherAdapter(fetchMock);

    await expect(
      adapter.publishAssets({
        target: githubTarget(),
        payload: payload(),
        token: "ghp_example",
        maxConcurrency: 3,
        assets: [asset()],
      }),
    ).resolves.toMatchObject([
      {
        status: "failed",
        artifactId: "art_22222222222222222222222222222222",
        failure: "uncertain",
      },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("re-fetches and validates the managed ref after a create race", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ private: false }))
      .mockResolvedValueOnce(new Response("missing", { status: 404 }))
      .mockResolvedValueOnce(new Response("already exists", { status: 422 }))
      .mockResolvedValueOnce(jsonResponse(evidenceRef()))
      .mockResolvedValueOnce(new Response("missing asset", { status: 404 }))
      .mockResolvedValueOnce(
        jsonResponse({ content: uploadedContent(), commit: { sha: EVIDENCE_COMMIT } }),
      );
    const adapter = new GitHubPublisherAdapter(fetchMock);

    await expect(
      adapter.publishAssets({
        target: githubTarget(),
        payload: payload(),
        token: "ghp_example",
        maxConcurrency: 3,
        assets: [asset()],
      }),
    ).resolves.toHaveLength(1);
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      expect.stringContaining("/git/ref/heads/spec-to-pr/evidence"),
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("settles every input when a create race does not produce a valid managed ref", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ private: false }))
      .mockResolvedValueOnce(new Response("missing", { status: 404 }))
      .mockResolvedValueOnce(new Response("already exists", { status: 422 }))
      .mockResolvedValueOnce(new Response("still missing", { status: 404 }));
    const adapter = new GitHubPublisherAdapter(fetchMock);

    await expect(
      adapter.publishAssets({
        target: githubTarget(),
        payload: payload(),
        token: "ghp_example",
        maxConcurrency: 3,
        assets: [asset()],
      }),
    ).resolves.toMatchObject([
      {
        status: "failed",
        artifactId: "art_22222222222222222222222222222222",
        failure: "uncertain",
      },
    ]);
  });

  it("retries shared-ref upload conflicts with a refreshed content SHA", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ private: false }))
      .mockResolvedValueOnce(jsonResponse(evidenceRef()))
      .mockResolvedValueOnce(new Response("missing asset", { status: 404 }))
      .mockResolvedValueOnce(new Response("ref moved", { status: 409 }))
      .mockResolvedValueOnce(jsonResponse({ sha: "blobsha2" }))
      .mockResolvedValueOnce(
        jsonResponse({ content: uploadedContent(), commit: { sha: EVIDENCE_COMMIT } }),
      );
    const adapter = new GitHubPublisherAdapter(fetchMock);

    await expect(
      adapter.publishAssets({
        target: githubTarget(),
        payload: payload(),
        token: "ghp_example",
        maxConcurrency: 3,
        assets: [asset()],
      }),
    ).resolves.toHaveLength(1);
    const uploads = fetchMock.mock.calls.filter((call) => call[1]?.method === "PUT");
    expect(uploads).toHaveLength(2);
    expect(JSON.parse(String(uploads[1]![1]?.body))).toMatchObject({
      branch: "spec-to-pr/evidence",
      sha: "blobsha2",
    });
  });

  it.each([
    [400, "permanent"],
    [408, "transient"],
    [429, "transient"],
    [503, "transient"],
  ] as const)("settles an upload HTTP %i failure as %s", async (status, failure) => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ private: false }))
      .mockResolvedValueOnce(jsonResponse(evidenceRef()))
      .mockResolvedValueOnce(new Response("missing asset", { status: 404 }))
      .mockResolvedValueOnce(new Response("do-not-leak-response", { status }));
    const adapter = new GitHubPublisherAdapter(fetchMock);

    await expect(
      adapter.publishAssets({
        target: githubTarget(),
        payload: payload(),
        token: "ghp_example",
        maxConcurrency: 3,
        assets: [asset()],
      }),
    ).resolves.toEqual([
      {
        status: "failed",
        artifactId: "art_22222222222222222222222222222222",
        failure,
        message: `GitHub upload review asset failed with HTTP ${status}`,
      },
    ]);
  });

  it("settles a successful response without a valid commit SHA as uncertain", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ private: false }))
      .mockResolvedValueOnce(jsonResponse(evidenceRef()))
      .mockResolvedValueOnce(new Response("missing asset", { status: 404 }))
      .mockResolvedValueOnce(jsonResponse({ content: {} }));
    const adapter = new GitHubPublisherAdapter(fetchMock);

    await expect(
      adapter.publishAssets({
        target: githubTarget(),
        payload: payload(),
        token: "ghp_example",
        maxConcurrency: 3,
        assets: [asset()],
      }),
    ).resolves.toMatchObject([{ status: "failed", failure: "uncertain" }]);
  });

  it.each([undefined, null, 42, [], "content", {}, { sha: "invalid" }])(
    "settles a successful response with malformed content %j as uncertain",
    async (content) => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ private: false }))
        .mockResolvedValueOnce(jsonResponse(evidenceRef()))
        .mockResolvedValueOnce(new Response("missing asset", { status: 404 }))
        .mockResolvedValueOnce(jsonResponse({ content, commit: { sha: EVIDENCE_COMMIT } }));
      const adapter = new GitHubPublisherAdapter(fetchMock);

      await expect(
        adapter.publishAssets({
          target: githubTarget(),
          payload: payload(),
          token: "ghp_example",
          maxConcurrency: 3,
          assets: [asset()],
        }),
      ).resolves.toMatchObject([
        {
          status: "failed",
          artifactId: "art_22222222222222222222222222222222",
          failure: "uncertain",
        },
      ]);
    },
  );

  it.each([
    {
      contentSha: "f".repeat(7),
      commitSha: EVIDENCE_COMMIT,
      malformedField: "content.sha",
    },
    {
      contentSha: "f".repeat(40),
      commitSha: "c".repeat(7),
      malformedField: "commit.sha",
    },
  ])("settles abbreviated $malformedField as uncertain", async ({ contentSha, commitSha }) => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ private: false }))
      .mockResolvedValueOnce(jsonResponse(evidenceRef()))
      .mockResolvedValueOnce(new Response("missing asset", { status: 404 }))
      .mockResolvedValueOnce(
        jsonResponse({
          content: { sha: contentSha },
          commit: { sha: commitSha },
        }),
      );
    const adapter = new GitHubPublisherAdapter(fetchMock);

    await expect(
      adapter.publishAssets({
        target: githubTarget(),
        payload: payload(),
        token: "ghp_example",
        maxConcurrency: 3,
        assets: [asset()],
      }),
    ).resolves.toEqual([
      {
        status: "failed",
        artifactId: "art_22222222222222222222222222222222",
        failure: "uncertain",
        message: "GitHub upload review asset returned a malformed response",
      },
    ]);
  });

  it("accepts full 64-character GitHub content and commit object IDs", async () => {
    const fullObjectId = "e".repeat(64);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ private: false }))
      .mockResolvedValueOnce(jsonResponse(evidenceRef()))
      .mockResolvedValueOnce(new Response("missing asset", { status: 404 }))
      .mockResolvedValueOnce(
        jsonResponse({
          content: { sha: fullObjectId },
          commit: { sha: fullObjectId },
        }),
      );
    const adapter = new GitHubPublisherAdapter(fetchMock);

    await expect(
      adapter.publishAssets({
        target: githubTarget(),
        payload: payload(),
        token: "ghp_example",
        maxConcurrency: 3,
        assets: [asset()],
      }),
    ).resolves.toMatchObject([
      {
        status: "published",
        asset: {
          url: expect.stringContaining(fullObjectId),
        },
      },
    ]);
  });

  it.each([
    { headSha: undefined },
    { reviewPacketId: undefined },
    { headSha: undefined, reviewPacketId: undefined },
  ])("settles every input when packet/head binding is missing", async (missing) => {
    const fetchMock = vi.fn();
    const adapter = new GitHubPublisherAdapter(fetchMock);
    const second = {
      ...asset(),
      artifactId: "art_33333333333333333333333333333333",
      artifactDigest: `sha256:${"e".repeat(64)}` as const,
      role: "browser" as const,
      filename: "browser.png",
    };

    await expect(
      adapter.publishAssets({
        target: githubTarget(),
        payload: { ...payload(), ...missing },
        token: "ghp_example",
        maxConcurrency: 3,
        assets: [asset(), second],
      }),
    ).resolves.toEqual([
      {
        status: "failed",
        artifactId: "art_22222222222222222222222222222222",
        failure: "uncertain",
        message: "GitHub prepare review asset upload failed",
      },
      {
        status: "failed",
        artifactId: "art_33333333333333333333333333333333",
        failure: "uncertain",
        message: "GitHub prepare review asset upload failed",
      },
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reads the current pull request body", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ body: "# synced" }));
    const adapter = new GitHubPublisherAdapter(fetchMock);

    await expect(
      adapter.readBody({
        target: githubTarget(),
        requestNumber: "123",
        token: "ghp_example",
      }),
    ).resolves.toBe("# synced");
  });

  it("serializes shared-branch mutations so six conflicting assets all publish", async () => {
    let nextMutationId = 0;
    const activeMutations = new Set<number>();
    const contendedMutations = new Set<number>();
    let maxActiveMutations = 0;
    const attemptsByUrl = new Map<string, number>();
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      if (url === "https://api.github.com/repos/acme/spec-to-pr") {
        return jsonResponse({ private: false });
      }
      if (url.includes("/git/ref/heads/spec-to-pr/evidence")) {
        return jsonResponse(evidenceRef());
      }
      if (init.method === "GET") return new Response("missing asset", { status: 404 });

      const attempt = (attemptsByUrl.get(url) ?? 0) + 1;
      attemptsByUrl.set(url, attempt);
      const mutationId = nextMutationId++;
      activeMutations.add(mutationId);
      if (activeMutations.size > 1) {
        for (const activeMutationId of activeMutations) {
          contendedMutations.add(activeMutationId);
        }
      }
      maxActiveMutations = Math.max(maxActiveMutations, activeMutations.size);
      await new Promise((resolve) => setTimeout(resolve, 5));
      activeMutations.delete(mutationId);
      if (attempt === 1 || contendedMutations.has(mutationId)) {
        return new Response("ref moved", { status: 409 });
      }
      return jsonResponse({ content: uploadedContent(), commit: { sha: EVIDENCE_COMMIT } });
    });
    const adapter = new GitHubPublisherAdapter(fetchMock);
    const assets = ["2", "3", "4", "5", "6", "7"].map((digit, index) => ({
      ...asset(),
      artifactId: `art_${digit.repeat(32)}`,
      artifactDigest: `sha256:${digit.repeat(64)}` as const,
      targetId: `target-${index}`,
    }));

    const outcomes = await adapter.publishAssets({
      target: githubTarget(),
      payload: payload(),
      token: "ghp_example",
      maxConcurrency: 99,
      assets,
    });

    expect(outcomes).toHaveLength(6);
    expect(outcomes.every((outcome) => outcome.status === "published")).toBe(true);
    expect(maxActiveMutations).toBe(1);
    expect([...attemptsByUrl.values()]).toEqual([2, 2, 2, 2, 2, 2]);
  });
});

function asset() {
  return {
    artifactId: "art_22222222222222222222222222222222",
    artifactDigest: `sha256:${"d".repeat(64)}` as const,
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
    headSha: REVIEWED_HEAD,
    reviewPacketId: PACKET_ID,
    mode: "draft",
    labels: ["spec-to-pr"],
    reviewers: [],
    assignees: [],
    reportArtifactId: "art_11111111111111111111111111111111",
  };
}

const REVIEWED_HEAD = "a".repeat(40);
const EVIDENCE_COMMIT = "c".repeat(40);
const PACKET_ID = `packet_${"b".repeat(64)}`;

function evidenceRef(sha = EVIDENCE_COMMIT) {
  return {
    ref: "refs/heads/spec-to-pr/evidence",
    object: { type: "commit", sha },
  };
}

function uploadedContent() {
  return {
    sha: "f".repeat(40),
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

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });
}
