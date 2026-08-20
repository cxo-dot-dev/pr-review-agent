import type { GitHubRequester } from "./types";

const STALE_APPROVE_MARKER_PREFIX = "<!-- pr-review-agent:stale-approve";

export function staleApprovalWarningMarker(
  sha: string,
  failedReviewIds: readonly number[],
): string {
  const reviews = [...failedReviewIds].sort((a, b) => a - b).join(",");
  return `${STALE_APPROVE_MARKER_PREFIX} sha=${sha} reviews=${reviews} -->`;
}

export function formatStaleApprovalWarning(input: {
  sha: string;
  failedReviewIds: readonly number[];
}): string {
  const shortSha = input.sha.slice(0, 7);
  return [
    "⚠️ **Ignore PR Review Agent's APPROVE** — GitHub still shows it, but it is no longer valid.",
    "",
    `**Why:** commit or check state changed. Current head: \`${shortSha}\`.`,
    "**Next step:** Do not merge on that bot approval. Require a fresh human review. PR Review Agent will re-review when checks are green on this head.",
    "",
    staleApprovalWarningMarker(input.sha, input.failedReviewIds),
  ].join("\n");
}

export function hasStaleApprovalWarning(
  comments: readonly { body?: string | null }[],
  sha: string,
  failedReviewIds: readonly number[],
): boolean {
  const marker = staleApprovalWarningMarker(sha, failedReviewIds);
  return comments.some((comment) => comment.body?.includes(marker));
}

export async function notifyStaleApprovalWarning(input: {
  request: GitHubRequester;
  post: (body: string) => Promise<unknown>;
  owner: string;
  repo: string;
  pullNumber: number;
  sha: string;
  failedReviewIds: readonly number[];
}): Promise<"posted" | "skipped"> {
  if (input.failedReviewIds.length === 0) return "skipped";

  const comments = await input.request<Array<{ body?: string | null }>>(
    "GET",
    `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/issues/${input.pullNumber}/comments?per_page=100`,
  );
  if (hasStaleApprovalWarning(comments, input.sha, input.failedReviewIds)) return "skipped";

  await input.post(
    formatStaleApprovalWarning({
      sha: input.sha,
      failedReviewIds: input.failedReviewIds,
    }),
  );
  return "posted";
}
