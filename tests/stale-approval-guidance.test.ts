import { describe, expect, it, vi } from "vitest";
import {
  formatStaleApprovalWarning,
  hasStaleApprovalWarning,
  notifyStaleApprovalWarning,
  staleApprovalWarningMarker,
} from "../agent/lib/stale-approval-guidance";
import type { GitHubRequester } from "../agent/lib/types";

const sha = "a".repeat(40);

describe("stale approval warning", () => {
  it("tells engineers to ignore a bot APPROVE that could not be dismissed", () => {
    const body = formatStaleApprovalWarning({ sha, failedReviewIds: [88, 77] });

    expect(body).toContain("⚠️ **Ignore PR Review Agent's APPROVE**");
    expect(body).toContain("GitHub still shows it, but it is no longer valid.");
    expect(body).toContain("**Why:** commit or check state changed. Current head: `aaaaaaa`.");
    expect(body).toContain("Do not merge on that bot approval. Require a fresh human review.");
    expect(body).toContain(staleApprovalWarningMarker(sha, [88, 77]));
    expect(staleApprovalWarningMarker(sha, [88, 77])).toBe(
      staleApprovalWarningMarker(sha, [77, 88]),
    );
  });

  it("skips posting when the same SHA and failed reviews already have a warning", async () => {
    const marker = staleApprovalWarningMarker(sha, [77, 88]);
    const request: GitHubRequester = vi.fn(async () => [{ body: `old note\n${marker}` }] as never);
    const posted: string[] = [];

    const result = await notifyStaleApprovalWarning({
      request,
      post: async (body) => {
        posted.push(body);
      },
      owner: "acme",
      repo: "example-app",
      pullNumber: 42,
      sha,
      failedReviewIds: [88, 77],
    });

    expect(result).toBe("skipped");
    expect(posted).toEqual([]);
    expect(hasStaleApprovalWarning([{ body: marker }], sha, [77, 88])).toBe(true);
  });

  it("posts once when no matching warning exists", async () => {
    const request: GitHubRequester = vi.fn(async () => [{ body: "unrelated comment" }] as never);
    const posted: string[] = [];

    const result = await notifyStaleApprovalWarning({
      request,
      post: async (body) => {
        posted.push(body);
      },
      owner: "acme",
      repo: "example-app",
      pullNumber: 42,
      sha,
      failedReviewIds: [77],
    });

    expect(result).toBe("posted");
    expect(posted).toHaveLength(1);
    expect(posted[0]).toContain("Ignore PR Review Agent's APPROVE");
    expect(posted[0]).toContain(staleApprovalWarningMarker(sha, [77]));
  });

  it("does not post when no dismissals failed", async () => {
    const result = await notifyStaleApprovalWarning({
      request: vi.fn(),
      post: vi.fn(),
      owner: "acme",
      repo: "example-app",
      pullNumber: 42,
      sha,
      failedReviewIds: [],
    });
    expect(result).toBe("skipped");
  });
});
