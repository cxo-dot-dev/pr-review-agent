import { defineTool } from "eve/tools";
import { never } from "eve/tools/approval";
import { z } from "zod/v4";
import { evaluateCheckGate } from "../lib/check-gate";
import { runtimePolicy } from "../lib/config";
import { authenticatedGitHubRequester, loadPullRequestSnapshot } from "../lib/github-api";
import { detectRiskArchetypes, RISK_CALIBRATION } from "../lib/risk-calibration";
import { calculatePolicyAssessment } from "../lib/risk-policy";
import { githubSessionTarget } from "../lib/session";

export default defineTool({
  description:
    "Load the exact current GitHub PR, checks, reviews, deterministic risk floor, human-only surfaces, and reviewability before assessing PR risk.",
  inputSchema: z.object({}),
  approval: never(),
  async execute(_input, ctx) {
    const target = githubSessionTarget(ctx);
    const policy = runtimePolicy();
    const snapshot = await loadPullRequestSnapshot(
      authenticatedGitHubRequester(),
      target.owner,
      target.repo,
      target.pullNumber,
    );
    const checkGate = evaluateCheckGate(snapshot.checkRuns, snapshot.statuses, policy);
    const policyAssessment = calculatePolicyAssessment(snapshot.files);

    return {
      repository: target.repository,
      pullNumber: target.pullNumber,
      headSha: snapshot.pullRequest.head.sha,
      baseBranch: snapshot.pullRequest.base.ref,
      title: snapshot.pullRequest.title,
      author: snapshot.pullRequest.user.login,
      draft: snapshot.pullRequest.draft,
      mergeable: snapshot.pullRequest.mergeable,
      changedFiles: snapshot.files,
      additions: snapshot.pullRequest.additions,
      deletions: snapshot.pullRequest.deletions,
      policyAssessment,
      candidateArchetypes: detectRiskArchetypes(snapshot.files),
      checkGate,
      reviewThreads: snapshot.reviewThreads,
      reviews: snapshot.reviews.map((review) => ({
        author: review.user?.login ?? "unknown",
        state: review.state,
        commitId: review.commit_id,
      })),
      policy: {
        version: RISK_CALIBRATION.version,
        minimumConfidence: policy.minimumConfidence,
        confidenceIsApprovalGate: true,
        levels: ["very_low", "low", "medium", "high"],
        aggregation: "The overall risk is the highest of the five dimension ratings, deterministic policy floor, and finding severity.",
        calibration: RISK_CALIBRATION,
      },
    };
  },
});
