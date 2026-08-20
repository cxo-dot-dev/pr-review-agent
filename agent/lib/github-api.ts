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

  const [files, checkRunsResponse, statusResponse, reviews, reviewThreads] = await Promise.all([
    listFiles(request, prefix, pullNumber, pullRequest.changed_files),
    request<{ check_runs: CheckRun[] }>(
      "GET",
      `${prefix}/commits/${encodeURIComponent(sha)}/check-runs?filter=latest&per_page=100`,
    ),
    request<{ statuses: CommitStatus[] }>(
      "GET",
      `${prefix}/commits/${encodeURIComponent(sha)}/status?per_page=100`,
    ),
    request<PullRequestReview[]>("GET", `${prefix}/pulls/${pullNumber}/reviews?per_page=100`),
    loadReviewThreads(request, owner, repo, pullNumber),
  ]);

  return {
    owner,
    repo,
    pullRequest,
    files,
    checkRuns: checkRunsResponse.check_runs,
    statuses: statusResponse.statuses,
    reviews,
    reviewThreads,
  };
}

async function listFiles(
  request: GitHubRequester,
  prefix: string,
  pullNumber: number,
  expected: number,
): Promise<PullRequestFile[]> {
  const files: PullRequestFile[] = [];
  for (let page = 1; page <= 30 && files.length < expected; page += 1) {
    const batch = await request<PullRequestFile[]>(
      "GET",
      `${prefix}/pulls/${pullNumber}/files?per_page=100&page=${page}`,
    );
    files.push(...batch);
    if (batch.length < 100) break;
  }
  return files;
}

async function loadReviewThreads(
  request: GitHubRequester,
  owner: string,
  repo: string,
  pullNumber: number,
): Promise<ReviewThreadSummary> {
  try {
    const result = await request<{
      data?: {
        repository?: {
          pullRequest?: { reviewThreads?: { nodes?: Array<{ isResolved?: boolean }> } };
        };
      };
      errors?: unknown[];
    }>("POST", "/graphql", {
      query: `query ReviewThreads($owner: String!, $repo: String!, $number: Int!) {
        repository(owner: $owner, name: $repo) {
          pullRequest(number: $number) {
            reviewThreads(first: 100) { nodes { isResolved } }
          }
        }
      }`,
      variables: { owner, repo, number: pullNumber },
    });
    if (result.errors?.length) return { known: false, unresolved: 0 };
    const nodes = result.data?.repository?.pullRequest?.reviewThreads?.nodes;
    if (!nodes) return { known: false, unresolved: 0 };
    return { known: true, unresolved: nodes.filter((node) => node.isResolved !== true).length };
  } catch {
    return { known: false, unresolved: 0 };
  }
}
