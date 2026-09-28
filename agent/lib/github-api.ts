import { githubInstallationToken } from "./github-credentials";
import type {
  CheckRun,
  CommitStatus,
  GitHubMethod,
  GitHubRequester,
  PullRequestDetails,
  PullRequestFile,
  PullRequestReview,
  PullRequestSnapshot,
  ReviewThreadSummary,
} from "./types";

const API_BASE = "https://api.github.com";

export function authenticatedGitHubRequester(): GitHubRequester {
  return async <T>(method: GitHubMethod, path: string, body?: object): Promise<T> => {
    const token = await githubInstallationToken();
    const response = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "x-github-api-version": "2022-11-28",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await response.text();
    const parsed = text ? (JSON.parse(text) as unknown) : null;
    if (!response.ok) {
      throw new Error(`GitHub ${method} ${path} failed with HTTP ${response.status}: ${text.slice(0, 500)}`);
    }
    return parsed as T;
  };
}

export async function loadPullRequestSnapshot(
  request: GitHubRequester,
  owner: string,
  repo: string,
  pullNumber: number,
): Promise<PullRequestSnapshot> {
  const prefix = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const pullRequest = await request<PullRequestDetails>("GET", `${prefix}/pulls/${pullNumber}`);
  const sha = pullRequest.head.sha;

  const [files, checkRuns, statuses, reviews, reviewThreads] = await Promise.all([
    listFiles(request, prefix, pullNumber, pullRequest.changed_files),
    listPages<CheckRun>(async (page) => {
      const response = await request<{ check_runs: CheckRun[]; total_count: number }>(
        "GET", `${prefix}/commits/${encodeURIComponent(sha)}/check-runs?filter=latest&per_page=100&page=${page}`,
      );
      return { items: response.check_runs, expected: response.total_count };
    }),
    listPages<CommitStatus>(async (page) => {
      const response = await request<{ statuses: CommitStatus[]; total_count: number }>(
        "GET", `${prefix}/commits/${encodeURIComponent(sha)}/status?per_page=100&page=${page}`,
      );
      return { items: response.statuses, expected: response.total_count };
    }),
    listPullRequestReviews(request, prefix, pullNumber),
    loadReviewThreads(request, owner, repo, pullNumber),
  ]);

  return { owner, repo, pullRequest, files, checkRuns, statuses, reviews, reviewThreads };
}

export async function listPullRequestReviews(
  request: GitHubRequester,
  prefix: string,
  pullNumber: number,
): Promise<PullRequestReview[]> {
  return listPages(async (page) => ({
    items: await request<PullRequestReview[]>(
      "GET", `${prefix}/pulls/${pullNumber}/reviews?per_page=100&page=${page}`,
    ),
  }));
}

async function listPages<T>(
  getPage: (page: number) => Promise<{ items: T[]; expected?: number }>,
): Promise<T[]> {
  const items: T[] = [];
  let expected: number | undefined;
  for (let page = 1; page <= 100; page += 1) {
    const batch = await getPage(page);
    if (expected !== undefined && batch.expected !== expected) {
      throw new Error("GitHub collection changed during pagination; retry the review.");
    }
    expected = batch.expected;
    items.push(...batch.items);
    if (expected !== undefined && items.length === expected) return items;
    if (batch.items.length < 100) {
      if (expected !== undefined && items.length !== expected) {
        throw new Error("GitHub returned an incomplete collection; refusing to review.");
      }
      return items;
    }
  }
  throw new Error("GitHub pagination limit reached; refusing to review incomplete data.");
}

async function listFiles(
  request: GitHubRequester,
  prefix: string,
  pullNumber: number,
  expected: number,
): Promise<PullRequestFile[]> {
  if (expected > 3_000) {
    throw new Error("Pull request exceeds GitHub's 3,000-file API limit; human review is required.");
  }
  return listPages(async (page) => ({
    items: await request<PullRequestFile[]>(
      "GET", `${prefix}/pulls/${pullNumber}/files?per_page=100&page=${page}`,
    ),
    expected,
  }));
}

async function loadReviewThreads(
  request: GitHubRequester,
  owner: string,
  repo: string,
  pullNumber: number,
): Promise<ReviewThreadSummary> {
  try {
    let after: string | null = null;
    let unresolved = 0;
    const cursors = new Set<string>();
    for (let page = 0; page < 100; page += 1) {
      const result: {
        data?: { repository?: { pullRequest?: { reviewThreads?: {
          nodes?: Array<{ isResolved?: boolean }>;
          pageInfo?: { hasNextPage: boolean; endCursor: string | null };
        } } } };
        errors?: unknown[];
      } = await request("POST", "/graphql", {
        query: `query ReviewThreads($owner: String!, $repo: String!, $number: Int!, $after: String) {
          repository(owner: $owner, name: $repo) {
            pullRequest(number: $number) {
              reviewThreads(first: 100, after: $after) {
                nodes { isResolved }
                pageInfo { hasNextPage endCursor }
              }
            }
          }
        }`,
        variables: { owner, repo, number: pullNumber, after },
      });
      const threads = result.data?.repository?.pullRequest?.reviewThreads;
      if (result.errors?.length || !threads?.nodes ||
          typeof threads.pageInfo?.hasNextPage !== "boolean") {
        return { known: false, unresolved };
      }
      unresolved += threads.nodes.filter((node) => node.isResolved !== true).length;
      if (!threads.pageInfo.hasNextPage) return { known: true, unresolved };
      const cursor = threads.pageInfo.endCursor;
      if (!cursor || cursors.has(cursor)) return { known: false, unresolved };
      cursors.add(cursor);
      after = cursor;
    }
    return { known: false, unresolved };
  } catch {
    return { known: false, unresolved: 0 };
  }
}
