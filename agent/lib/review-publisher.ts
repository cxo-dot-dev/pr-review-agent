import { formatNeedsHumanGuidance } from "./blocker-guidance";
import { POLICY_VERSION, RISK_CHECK_NAME, RISK_MARKER_PREFIX } from "./config";
import type { ApprovalDecision } from "./decision";
import { APPROVE_HANDOFF, decisionEmoji } from "./decision-presentation";
import type { FinalRisk, PolicyAssessment } from "./risk-policy";
import type {
  GitHubRequester,
  PullRequestReview,
  PullRequestSnapshot,
  RiskDimensions,
  RiskEvidence,
  RiskFinding,
} from "./types";

export interface PublishRiskInput {
  request: GitHubRequester;
  snapshot: PullRequestSnapshot;
  finalRisk: FinalRisk;
  policy: PolicyAssessment;
  dimensions: RiskDimensions;
  confidence: number;
  summary: string;
  evidence: readonly RiskEvidence[];
  findings: readonly RiskFinding[];
  decision: ApprovalDecision;
}

export interface PublishRiskResult {
  checkRunId: number;
  reviewId: number | null;
  reviewEvent: ReviewEvent;
  reusedReview: boolean;
}

export type ReviewEvent = "APPROVE" | "REQUEST_CHANGES" | "COMMENT";

export async function publishRiskAssessment(input: PublishRiskInput): Promise<PublishRiskResult> {
  const { snapshot } = input;
  const prefix = `/repos/${encodeURIComponent(snapshot.owner)}/${encodeURIComponent(snapshot.repo)}`;
  const sha = snapshot.pullRequest.head.sha;
  const reviewEvent = reviewEventFor(input.decision);
  if (input.decision.disposition !== "approve") {
    await dismissSnapshotAgentApprovals(input.request, snapshot);
  }
  const externalId = riskExternalId(sha);
  const reviewBody = renderReviewBody(input, reviewEvent);
  const checkOutput = renderCheckOutput(input, reviewEvent);
  const existingCheck = snapshot.checkRuns.find(
    (run) => run.external_id === externalId || (run.name === RISK_CHECK_NAME && run.app?.slug?.includes("eng-agent")),
  );

  const checkPayload = {
    name: RISK_CHECK_NAME,
    head_sha: sha,
    status: "completed",
    conclusion: checkConclusionFor(input.decision),
    external_id: externalId,
    output: checkOutput,
  };
  const check = existingCheck
    ? await input.request<{ id: number }>("PATCH", `${prefix}/check-runs/${existingCheck.id}`, checkPayload)
    : await input.request<{ id: number }>("POST", `${prefix}/check-runs`, checkPayload);

  const marker = riskMarker(sha, reviewEvent);
  const existingReview = snapshot.reviews.find(
    (review) =>
      review.user?.type === "Bot" &&
      review.state.toUpperCase() !== "DISMISSED" &&
      review.body?.includes(marker),
  );
  if (existingReview) {
    return {
      checkRunId: check.id,
      reviewId: existingReview.id,
      reviewEvent,
      reusedReview: true,
    };
  }

  const review = await input.request<{ id: number }>(
    "POST",
    `${prefix}/pulls/${snapshot.pullRequest.number}/reviews`,
    {
      commit_id: sha,
      event: reviewEvent,
      body: reviewBody,
    },
  );
  return { checkRunId: check.id, reviewId: review.id, reviewEvent, reusedReview: false };
}

export async function dismissAgentApprovals(input: {
  request: GitHubRequester;
  owner: string;
  repo: string;
  pullNumber: number;
  currentSha: string;
  includeCurrentSha: boolean;
}): Promise<{ dismissed: number; failed: readonly number[] }> {
  const prefix = `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}`;
  const reviews = await input.request<PullRequestReview[]>(
    "GET",
    `${prefix}/pulls/${input.pullNumber}/reviews?per_page=100`,
  );
  const candidates = reviews.filter(
    (review) =>
      review.user?.type === "Bot" &&
      review.state.toUpperCase() === "APPROVED" &&
      review.body?.includes(RISK_MARKER_PREFIX) &&
      (input.includeCurrentSha || review.commit_id !== input.currentSha),
  );
  const failed: number[] = [];
  let dismissed = 0;
  for (const review of candidates) {
    try {
      await input.request(
        "PUT",
        `${prefix}/pulls/${input.pullNumber}/reviews/${review.id}/dismissals`,
        {
          event: "DISMISS",
          message: `PR Review Agent invalidated this approval because commit or check state changed. Current head: ${input.currentSha}.`,
        },
      );
      dismissed += 1;
    } catch {
      failed.push(review.id);
    }
  }
  return { dismissed, failed };
}

export function riskExternalId(sha: string): string {
  return `pr-review-agent:pr-risk:${POLICY_VERSION}:${sha}`;
}

export function riskMarker(sha: string, event: ReviewEvent): string {
  return `${riskAssessmentMarker(sha)}decision=${event} -->`;
}

export function riskAssessmentMarker(sha: string): string {
  return `${RISK_MARKER_PREFIX} policy=${POLICY_VERSION} sha=${sha} `;
}

export function renderReviewBody(input: PublishRiskInput, event: ReviewEvent): string {
  const { finalRisk, policy } = input;
  const orderedFindings = [...input.findings].sort(
    (left, right) => severityWeight(right.severity) - severityWeight(left.severity),
  );
  const visibleFindings = orderedFindings.slice(0, 4);
  const findings = visibleFindings.length
    ? visibleFindings.map(renderFinding).join("\n")
    : "- No material findings.";
  const flags = policy.riskFlags.length
    ? policy.riskFlags.map((flag) => `${clean(flag.reason)} (floor ${flag.scoreFloor})`).join(" · ")
    : "None";
  const humanOnly = policy.humanReviewRequirements.length
    ? policy.humanReviewRequirements.map((requirement) => clean(requirement.reason)).join(" · ")
    : "None";
  const reviewability = policy.reviewability.sufficient
    ? `Sufficient · ${policy.reviewability.reviewableFiles} reviewable files · ${policy.reviewability.reviewableChanges} reviewable changes`
    : `Insufficient · ${policy.reviewability.reasons.map(clean).join(" · ")}`;
  const blockers = input.decision.blockers.length
    ? input.decision.blockers.map((blocker) => clean(blocker)).join(" · ")
    : "None";
  const evidence = input.evidence.length
    ? input.evidence
        .map((item) => `- \`${clean(item.path)}\` — ${compact(item.explanation, 240)}`)
        .join("\n")
    : "- No file-specific evidence supplied.";
  const icon = decisionEmoji(input.decision, finalRisk.band);
  const disposition = event === "APPROVE"
    ? `${icon} **APPROVE**`
    : event === "REQUEST_CHANGES"
      ? `${icon} **REQUEST CHANGES**`
      : `${icon} **NEEDS HUMAN**`;
  const extraFindingCount = orderedFindings.length - visibleFindings.length;
  const dimensions = input.dimensions;
  const findingCounts = countFindings(orderedFindings);
  const dispositionRationale = renderDispositionRationale(event, input);

  return [
    "| Risk score | Disposition | Confidence |",
    "| :-- | :-- | --: |",
    `| **${finalRisk.score}/100 · ${titleCase(finalRisk.band)}** | ${disposition} | **${(input.confidence * 100).toFixed(0)}%** |`,
    "",
    ...dispositionRationale,
    "",
    `**Summary:** ${singleLine(input.summary)}`,
    "",
    "<details>",
    `<summary>Review details · ${findingCountLabel(findingCounts)}</summary>`,
    "",
    "#### Review notes",
    "",
    findings,
    extraFindingCount > 0 ? `- ${extraFindingCount} additional finding(s) below.` : "",
    "",
    "#### Evidence",
    "",
    evidence,
    "",
    ...(extraFindingCount > 0
      ? ["#### Additional findings", "", orderedFindings.slice(4).map(renderFinding).join("\n"), ""]
      : []),
    "#### Scoring",
    "",
    `- Model ${finalRisk.modelScore} · policy floor ${finalRisk.policyFloor} · final ${finalRisk.score}`,
    `- Surface ${dimensions.changeSurface}/20 · blast radius ${dimensions.blastRadius}/20 · reversibility ${dimensions.reversibility}/15`,
    `- Data/security ${dimensions.dataSecurity}/20 · operations ${dimensions.operationalRisk}/15 · verification gap ${dimensions.verificationGap}/10`,
    "",
    "#### Policy and gates",
    "",
    `- Risk floors: ${flags}`,
    `- Human-only surfaces: ${humanOnly}`,
    `- Reviewability: ${reviewability}`,
    `- Approval blockers: ${blockers}`,
    `- Commit: \`${input.snapshot.pullRequest.head.sha}\``,
    `- Policy: \`${POLICY_VERSION}\``,
    "",
    "</details>",
    "",
    riskMarker(input.snapshot.pullRequest.head.sha, event),
  ].filter((line, index, lines) => line !== "" || lines[index - 1] !== "").join("\n");
}

function renderDispositionRationale(event: ReviewEvent, input: PublishRiskInput): string[] {
  if (event === "APPROVE") {
    return [
      `> **Why approved:** ${APPROVE_HANDOFF.why}`,
      `> **Next step:** ${APPROVE_HANDOFF.nextStep}`,
    ];
  }

  if (event === "COMMENT") {
    const guidance = formatNeedsHumanGuidance(input.decision.blockers, input.confidence);
    const lines = [
      `> **Why human review is required:** ${clean(guidance.primary.blockedBy)}`,
    ];
    if (guidance.additional.length > 0) {
      lines.push(
        `> **What blocked auto-approval:** ${guidance.all.map((item) => clean(item.blockedBy)).join(" · ")}`,
      );
    }
    lines.push(`> **Next step:** ${clean(guidance.primary.nextStep)}`);
    return lines;
  }

  const blockerSummary = input.decision.blockers.length
    ? input.decision.blockers.map((blocker) => friendlyBlocker(blocker, input.confidence)).join(" · ")
    : APPROVE_HANDOFF.why;
  return [`> **${dispositionHeading(event)}:** ${blockerSummary}`];
}

export function renderCheckOutput(input: PublishRiskInput, event: ReviewEvent) {
  const dimensions = input.dimensions;
  const decision = dispositionLabel(event);
  const text = [
    `| Dimension | Score |`,
    `| --- | ---: |`,
    `| Change surface | ${dimensions.changeSurface}/20 |`,
    `| Blast radius | ${dimensions.blastRadius}/20 |`,
    `| Reversibility | ${dimensions.reversibility}/15 |`,
    `| Data and security | ${dimensions.dataSecurity}/20 |`,
    `| Operational risk | ${dimensions.operationalRisk}/15 |`,
    `| Verification gap | ${dimensions.verificationGap}/10 |`,
    "",
    `Model score: ${input.finalRisk.modelScore}. Deterministic floor: ${input.finalRisk.policyFloor}.`,
    `Bot disposition: ${decision}. Confidence: ${(input.confidence * 100).toFixed(0)}%.`,
    `Reviewability: ${input.policy.reviewability.sufficient ? "sufficient" : "insufficient"}. Human-only surfaces: ${input.policy.humanReviewRequirements.length}.`,
    `Policy: ${POLICY_VERSION}. Commit: ${input.snapshot.pullRequest.head.sha}.`,
  ].join("\n");

  return {
    title: `Risk ${input.finalRisk.score}/100 (${input.finalRisk.band.toUpperCase()}) · ${decision}`,
    summary: singleLine(input.summary),
    text,
  };
}

function renderFinding(finding: RiskFinding): string {
  const location = finding.path
    ? ` — \`${clean(finding.path)}${finding.line ? `:${finding.line}` : ""}\``
    : "";
  return `- **${finding.severity.toUpperCase()}: ${compact(finding.title, 120)}**${location} — ${compact(finding.body, 220)}`;
}

async function dismissSnapshotAgentApprovals(
  request: GitHubRequester,
  snapshot: PullRequestSnapshot,
): Promise<void> {
  const prefix = `/repos/${encodeURIComponent(snapshot.owner)}/${encodeURIComponent(snapshot.repo)}`;
  const approvals = snapshot.reviews.filter(
    (review) =>
      review.user?.type === "Bot" &&
      review.state.toUpperCase() === "APPROVED" && review.body?.includes(RISK_MARKER_PREFIX),
  );
  for (const review of approvals) {
    await request(
      "PUT",
      `${prefix}/pulls/${snapshot.pullRequest.number}/reviews/${review.id}/dismissals`,
      {
        event: "DISMISS",
        message: `PR Review Agent invalidated this automated approval because the policy ${POLICY_VERSION} assessment for ${snapshot.pullRequest.head.sha} no longer permits automated approval.`,
      },
    );
  }
}

function severityWeight(severity: RiskFinding["severity"]): number {
  return severity === "high" ? 3 : severity === "medium" ? 2 : 1;
}

function countFindings(findings: readonly RiskFinding[]): Record<RiskFinding["severity"], number> {
  return findings.reduce(
    (counts, finding) => ({ ...counts, [finding.severity]: counts[finding.severity] + 1 }),
    { high: 0, medium: 0, low: 0 },
  );
}

function findingCountLabel(counts: Record<RiskFinding["severity"], number>): string {
  const labels = (["high", "medium", "low"] as const)
    .filter((severity) => counts[severity] > 0)
    .map((severity) => `${counts[severity]} ${severity}`);
  return labels.length > 0 ? `${labels.join(" · ")} finding(s)` : "no material findings";
}

function friendlyBlocker(blocker: string, confidence: number): string {
  if (blocker.includes("unresolved review thread")) {
    return blocker.replace("review thread(s)", "review thread");
  }
  if (blocker === "assessment confidence is below policy") {
    return `confidence ${(confidence * 100).toFixed(0)}% (needs 90%)`;
  }
  if (blocker === "risk is medium, not low") {
    return "risk is MEDIUM (only LOW can auto-approve)";
  }
  if (blocker === "risk is high, not low") {
    return "risk is HIGH (only LOW can auto-approve)";
  }
  if (blocker.startsWith("human-only surface: ")) {
    return `human-only: ${clean(blocker.slice("human-only surface: ".length))}`;
  }
  if (blocker.startsWith("autonomous reviewability limit: ")) {
    return `reviewability limit: ${clean(blocker.slice("autonomous reviewability limit: ".length))}`;
  }
  return clean(blocker);
}

function reviewEventFor(decision: ApprovalDecision): ReviewEvent {
  if (decision.disposition === "approve") return "APPROVE";
  if (decision.disposition === "request_changes") return "REQUEST_CHANGES";
  return "COMMENT";
}

function checkConclusionFor(decision: ApprovalDecision): "success" | "action_required" | "neutral" {
  if (decision.disposition === "approve") return "success";
  if (decision.disposition === "request_changes") return "action_required";
  return "neutral";
}

function dispositionHeading(event: ReviewEvent): string {
  if (event === "APPROVE") return "Why approved";
  if (event === "REQUEST_CHANGES") return "What must change";
  return "Why human review is required";
}

function dispositionLabel(event: ReviewEvent): string {
  if (event === "APPROVE") return "APPROVE";
  if (event === "REQUEST_CHANGES") return "REQUEST CHANGES";
  return "NEEDS HUMAN";
}

function titleCase(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1).toLowerCase()}`;
}

function compact(value: string, maximum: number): string {
  const valueWithoutMarkup = singleLine(value);
  if (valueWithoutMarkup.length <= maximum) return valueWithoutMarkup;
  return `${valueWithoutMarkup.slice(0, maximum - 1).trimEnd()}…`;
}

function singleLine(value: string): string {
  return clean(value).replace(/\s+/gu, " ");
}

function clean(value: string): string {
  return value.replaceAll("<!--", "&lt;!--").replaceAll("-->", "--&gt;").trim();
}
