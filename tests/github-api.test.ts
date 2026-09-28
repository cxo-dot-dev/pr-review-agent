import { describe, expect, it, vi } from "vitest";
vi.mock("../agent/lib/github-credentials", () => ({ githubInstallationToken: vi.fn() }));
import { loadPullRequestSnapshot } from "../agent/lib/github-api";
import type { GitHubRequester } from "../agent/lib/types";
import { snapshot } from "./fixtures";

function requester(overrides: (path: string, body?: object) => unknown) {
  const fixture = snapshot();
  return vi.fn(async (_method, path, body) => {
    const override = overrides(path, body);
    if (override !== undefined) return override;
    if (path.endsWith("/pulls/42")) return fixture.pullRequest;
    if (path.includes("/files?")) return fixture.files;
    if (path.includes("/check-runs?")) return { check_runs: [], total_count: 0 };
    if (path.includes("/status?")) return { statuses: [], total_count: 0 };
    if (path.includes("/reviews?")) return [];
    if (path === "/graphql") return threads([], false, null);
    throw new Error(`Unexpected path: ${path}`);
  }) as unknown as GitHubRequester;
}
function threads(nodes: Array<{ isResolved: boolean }>, hasNextPage: boolean, endCursor: string | null) {
  return { data: { repository: { pullRequest: { reviewThreads: {
    nodes, pageInfo: { hasNextPage, endCursor },
  } } } } };
}
const load = (request: GitHubRequester) => loadPullRequestSnapshot(request, "acme", "example-app", 42);

describe("complete GitHub snapshots", () => {
  it("loads checks, statuses, reviews, and files beyond the first page", async () => {
    const request = requester((path) => {
      const page = Number(new URL(path, "https://api.github.com").searchParams.get("page"));
      if (path.endsWith("/pulls/42")) return { ...snapshot().pullRequest, changed_files: 101 };
      const count = page === 1 ? 100 : 1;
      const items = Array.from({ length: count }, (_, index) => ({ id: (page - 1) * 100 + index + 1 }));
      if (path.includes("/check-runs?")) return { check_runs: items, total_count: 101 };
      if (path.includes("/status?")) return { statuses: items, total_count: 101 };
      if (path.includes("/reviews?") || path.includes("/files?")) return items;
    });
    const result = await load(request);
    for (const items of [result.checkRuns, result.statuses, result.reviews, result.files]) {
      expect(items).toHaveLength(101);
    }
  });

  it("includes unresolved review threads on subsequent pages", async () => {
    const request = requester((path, body) => {
      if (path !== "/graphql") return;
      const after = (body as { variables: { after: string | null } }).variables.after;
      return after ? threads([{ isResolved: false }], false, null)
        : threads(Array.from({ length: 100 }, () => ({ isResolved: true })), true, "next");
    });
    expect((await load(request)).reviewThreads).toEqual({ known: true, unresolved: 1 });
  });

  it("fails closed on incomplete files or checks and the GitHub file cap", async () => {
    await expect(load(requester((path) => path.includes("/files?") ? [] : undefined)))
      .rejects.toThrow("incomplete collection");
    await expect(load(requester((path) => path.includes("/check-runs?")
      ? { check_runs: [], total_count: 1 } : undefined))).rejects.toThrow("incomplete collection");
    await expect(load(requester((path) => path.endsWith("/pulls/42")
      ? { ...snapshot().pullRequest, changed_files: 3_001 } : undefined)))
      .rejects.toThrow("3,000-file");
  });

  it("does not claim known thread state with missing pagination metadata or repeated cursors", async () => {
    for (const response of [
      { data: { repository: { pullRequest: { reviewThreads: { nodes: [] } } } } },
      threads([], true, "repeated"),
      { errors: [{ message: "unavailable" }] },
    ]) {
      const result = await load(requester((path) => path === "/graphql" ? response : undefined));
      expect(result.reviewThreads.known).toBe(false);
    }
  });
});
