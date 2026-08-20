import type { CheckGateResult } from "./check-gate";
import type { GitHubRequester } from "./types";

const WAITING_MARKER_PREFIX = "<!-- pr-review-agent:waiting-checks";

export function checkGateFingerprint(gate: CheckGateResult): string {
  const parts = [
    ...gate.missing.map((name) => `missing:${name}`),
    ...gate.pending.map((name) => `pending:${name}`),
    ...gate.blocking.map((name) => `blocking:${name}`),
  ];
  return parts.join("|") || "none";
}

export function waitingChecksMarker(sha: string, gate: CheckGateResult): string {
  return `${WAITING_MARKER_PREFIX} sha=${sha} fingerprint=${checkGateFingerprint(gate)} -->`;
}

export function checkGateNextStep(gate: CheckGateResult): string {
  const hasBlocking = gate.blocking.length > 0;
  const hasWait = gate.missing.length > 0 || gate.pending.length > 0;
  if (hasBlocking && hasWait) {
    return "Fix the failing or unapproved checks first, then wait for the remaining required checks on this head. Review starts automatically when the check gate is green.";
  }
  if (hasBlocking) {
    return "Fix the failing or unapproved checks, then push or re-run them. Review starts automatically when the check gate is green.";
  }
  return "Wait for the required checks to finish on this head. Review starts automatically when the check gate is green.";
}

export function formatCheckGateWait(gate: CheckGateResult, sha: string): string {
  const shortSha = sha.slice(0, 7);
  const waitingOn = [
    ...gate.missing.map((name) => `${name} (missing)`),
    ...gate.pending.map((name) => `${name} (pending)`),
    ...gate.blocking,
  ].join(" · ");

  return [
    `⏳ **PR Review Agent hasn't started** — required checks aren't green on \`${shortSha}\`.`,
    "",
    `**Waiting on:** ${waitingOn || "configured check gate is not green"}`,
    "",
    `**Next step:** ${checkGateNextStep(gate)}`,
    "",
    waitingChecksMarker(sha, gate),
  ].join("\n");
}

export function hasWaitingChecksComment(
  comments: readonly { body?: string | null }[],
  sha: string,
  gate: CheckGateResult,
): boolean {
  const marker = waitingChecksMarker(sha, gate);
  return comments.some((comment) => comment.body?.includes(marker));
}

export async function notifyWaitingOnChecks(input: {
  request: GitHubRequester;
  post: (body: string) => Promise<unknown>;
  owner: string;
  repo: string;
  pullNumber: number;
  sha: string;
  gate: CheckGateResult;
}): Promise<"posted" | "skipped"> {
  if (input.gate.ready) return "skipped";

  const comments = await input.request<Array<{ body?: string | null }>>(
    "GET",
    `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/issues/${input.pullNumber}/comments?per_page=100`,
  );
  if (hasWaitingChecksComment(comments, input.sha, input.gate)) return "skipped";

  await input.post(formatCheckGateWait(input.gate, input.sha));
  return "posted";
}
