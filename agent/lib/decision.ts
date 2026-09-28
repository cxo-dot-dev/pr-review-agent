import type { CheckGateResult } from "./check-gate";
import type { FinalRisk, PolicyAssessment } from "./risk-policy";
import type { PullRequestSnapshot, RiskFinding } from "./types";

export type ReviewDisposition = "approve" | "request_changes" | "needs_human";

export interface ApprovalDecision {
  disposition: ReviewDisposition;
  blockers: readonly string[];
}

export function evaluateApprovalDecision(input: {
  snapshot: PullRequestSnapshot;
  checkGate: CheckGateResult;
  finalRisk: FinalRisk;
  findings: readonly RiskFinding[];
  repositories: readonly string[];
  baseBranches: readonly string[];
  minimumConfidence: number;
  confidence: number;
  policy: PolicyAssessment;
}): ApprovalDecision {
  const { pullRequest } = input.snapshot;
  const fullName = `${input.snapshot.owner}/${input.snapshot.repo}`;
  const blockers: string[] = [];

  if (!input.repositories.includes(fullName)) blockers.push(`repository ${fullName} is not allowlisted`);
  if (!input.baseBranches.includes(pullRequest.base.ref)) {
    blockers.push(`base branch ${pullRequest.base.ref} is not allowlisted`);
  }
  if (pullRequest.state !== "open") blockers.push("pull request is not open");
  if (pullRequest.draft) blockers.push("pull request is a draft");
  if (pullRequest.mergeable === false) blockers.push("pull request has merge conflicts");
  if (pullRequest.head.repo?.full_name !== pullRequest.base.repo.full_name) {
    blockers.push("fork pull requests require human approval");
  }
  if (!input.checkGate.ready) blockers.push("configured check gate is not green");
  if (!input.snapshot.reviewThreads.known) blockers.push("review-thread resolution could not be verified");
  if (input.snapshot.reviewThreads.unresolved > 0) {
    blockers.push(`${input.snapshot.reviewThreads.unresolved} unresolved review thread(s)`);
  }
  if (hasActiveHumanChangeRequest(input.snapshot)) blockers.push("an active changes-requested review exists");
  blockers.push(
    ...input.policy.humanReviewRequirements.map(
      (requirement) => `human-only surface: ${requirement.reason}`,
    ),
  );
  blockers.push(
    ...input.policy.reviewability.reasons.map(
      (reason) => `autonomous reviewability limit: ${reason}`,
    ),
  );
  if (input.finalRisk.band === "medium" || input.finalRisk.band === "high") {
    blockers.push(`risk is ${input.finalRisk.band}, not low`);
  }
  if (input.confidence < input.minimumConfidence) blockers.push("assessment confidence is below policy");
  const hasBlockingFinding = input.findings.some((finding) => finding.severity !== "low");
  if (hasBlockingFinding) {
    blockers.push("a medium or high finding exists");
  }

  const disposition: ReviewDisposition = hasBlockingFinding
    ? "request_changes"
    : blockers.length > 0
      ? "needs_human"
      : "approve";
  return { disposition, blockers };
}

function hasActiveHumanChangeRequest(snapshot: PullRequestSnapshot): boolean {
  const latest = new Map<string, string>();
  for (const review of snapshot.reviews) {
    const login = review.user?.login;
    if (
      !login ||
      (review.user?.type === "Bot" && review.body?.includes("pr-review-agent:risk"))
    ) continue;
    const state = review.state.toUpperCase();
    if (state === "COMMENTED" || state === "PENDING") continue;
    latest.set(login, state);
  }
  return [...latest.values()].some((state) => state === "CHANGES_REQUESTED");
}
