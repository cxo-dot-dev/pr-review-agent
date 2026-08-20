import {
  defaultGitHubAuth,
  githubChannel,
  type GitHubEventContext,
  type GitHubInboundContext,
  type GitHubJsonObject,
} from "eve/channels/github";
import { evaluateCheckGate, type CheckGateResult } from "../lib/check-gate";
import { notifyWaitingOnChecks } from "../lib/check-gate-guidance";
import { runtimePolicy } from "../lib/config";
import { githubCredentials } from "../lib/github-credentials";
import { loadPullRequestSnapshot } from "../lib/github-api";
import { notifyStaleApprovalWarning } from "../lib/stale-approval-guidance";
import { dismissAgentApprovals, riskAssessmentMarker } from "../lib/review-publisher";
import {
  isRiskReviewCompletion,
  riskReviewRetirementToken,
} from "../lib/risk-session";
import type { GitHubMethod, GitHubRequester, PullRequestSnapshot } from "../lib/types";

const botName = process.env.ENG_AGENT_BOT_NAME ?? "pr-review-agent";

export default githubChannel({
  botName,
  credentials: githubCredentials,
  progress: { reactions: true },
  pullRequestContext: {
    excludedFiles: ["**/package-lock.json", "**/*.snap", "docs/**/*.html"],
  },
  async onCheckSuite(ctx, suite) {
    const pullNumber = suite.pullRequests[0];
    if (!pullNumber || suite.app.slug === botName) return null;

    const request = channelRequester(ctx);
    if (suite.action !== "completed") {
      await invalidateApproval(ctx, request, pullNumber, suite.headSha ?? "unknown", true);
      return null;
    }
    if (
      suite.conclusion &&
      !["success", "neutral", "skipped"].includes(suite.conclusion)
    ) {
      await invalidateApproval(ctx, request, pullNumber, suite.headSha ?? "unknown", true);
      await notifyIfChecksBlockReview(ctx, request, pullNumber);
      return null;
    }

    return eligibleDispatch(ctx, request, pullNumber);
  },
  async onPullRequest(ctx, event) {
    const sha = event.headSha ?? "unknown";
    if (["synchronize", "converted_to_draft", "closed"].includes(event.action)) {
      await invalidateApproval(
        ctx,
        channelRequester(ctx),
        event.pullRequestNumber,
        sha,
        event.action !== "synchronize",
      );
      return null;
    }
    if (["ready_for_review", "reopened"].includes(event.action)) {
      return eligibleDispatch(ctx, channelRequester(ctx), event.pullRequestNumber);
    }
    return null;
  },
  events: {
    async "message.completed"(data, channel) {
      if (
        data.finishReason === "tool-calls" ||
        !data.message ||
        (channel.state.triggeringCommentId === null && channel.state.reviewCommentId === null)
      ) {
        return;
      }
      if (isRiskReviewCompletion(data.message)) {
        retireRiskReviewSession(channel);
        return;
      }
      await channel.thread.post(data.message);
    },
    async "turn.completed"(_data, channel) {
      // CI- and PR-event reviews have no triggering comment. Retire those sessions
      // after every completed turn so the next head/policy review cannot inherit ratings.
      if (channel.state.triggeringCommentId === null && channel.state.reviewCommentId === null) {
        retireRiskReviewSession(channel);
      }
    },
  },
});

async function eligibleDispatch(
  ctx: GitHubInboundContext,
  request: GitHubRequester,
  pullNumber: number,
) {
  const target = await loadEligibleRiskTarget(ctx, request, pullNumber);
  if (!target) return null;
  if (!target.gate.ready) {
    await postWaitingChecksComment(ctx, request, target.snapshot, target.gate);
    return null;
  }

  return {
    auth: defaultGitHubAuth(ctx),
    context: [
      [
        "This is an automated PR-risk review turn.",
        `Review ${ctx.repository.fullName}#${pullNumber} at exact head ${target.snapshot.pullRequest.head.sha}.`,
        "Load the pr-risk-review skill, confirm `git rev-parse HEAD` equals the exact head above, inspect the checkout, call get_pr_risk_context, then call submit_pr_risk_decision exactly once.",
        "Do not modify the repository and do not post a separate conversational reply.",
      ].join("\n"),
    ],
  };
}

async function notifyIfChecksBlockReview(
  ctx: GitHubInboundContext,
  request: GitHubRequester,
  pullNumber: number,
): Promise<void> {
  const target = await loadEligibleRiskTarget(ctx, request, pullNumber);
  if (!target || target.gate.ready) return;
  await postWaitingChecksComment(ctx, request, target.snapshot, target.gate);
}

async function loadEligibleRiskTarget(
  ctx: GitHubInboundContext,
  request: GitHubRequester,
  pullNumber: number,
): Promise<{ snapshot: PullRequestSnapshot; gate: CheckGateResult } | null> {
  const policy = runtimePolicy();
  if (!policy.repositories.includes(ctx.repository.fullName)) return null;
  const snapshot = await loadPullRequestSnapshot(
    request,
    ctx.repository.owner,
    ctx.repository.name,
    pullNumber,
  );
  if (!policy.baseBranches.includes(snapshot.pullRequest.base.ref)) return null;
  if (snapshot.pullRequest.state !== "open" || snapshot.pullRequest.draft) return null;
  if (alreadyAssessed(snapshot)) return null;

  return {
    snapshot,
    gate: evaluateCheckGate(snapshot.checkRuns, snapshot.statuses, policy),
  };
}

function alreadyAssessed(snapshot: PullRequestSnapshot): boolean {
  const marker = riskAssessmentMarker(snapshot.pullRequest.head.sha);
  return snapshot.reviews.some(
    (review) =>
      review.user?.type === "Bot" &&
      review.state.toUpperCase() !== "DISMISSED" &&
      review.body?.includes(marker) &&
      review.commit_id === snapshot.pullRequest.head.sha,
  );
}

async function postWaitingChecksComment(
  ctx: GitHubInboundContext,
  request: GitHubRequester,
  snapshot: PullRequestSnapshot,
  gate: CheckGateResult,
): Promise<void> {
  await notifyWaitingOnChecks({
    request,
    post: (body) => ctx.thread.post(body),
    owner: snapshot.owner,
    repo: snapshot.repo,
    pullNumber: snapshot.pullRequest.number,
    sha: snapshot.pullRequest.head.sha,
    gate,
  });
}

function channelRequester(ctx: GitHubInboundContext): GitHubRequester {
  return async <T>(method: GitHubMethod, path: string, body?: object): Promise<T> => {
    const response = await ctx.github.request<T>({
      method,
      path,
      ...(body ? { body: body as GitHubJsonObject } : {}),
    });
    return response.body;
  };
}

async function invalidateApproval(
  ctx: GitHubInboundContext,
  request: GitHubRequester,
  pullNumber: number,
  currentSha: string,
  includeCurrentSha: boolean,
): Promise<void> {
  const result = await dismissAgentApprovals({
    request,
    owner: ctx.repository.owner,
    repo: ctx.repository.name,
    pullNumber,
    currentSha,
    includeCurrentSha,
  });
  if (result.failed.length === 0) return;

  await notifyStaleApprovalWarning({
    request,
    post: (body) => ctx.thread.post(body),
    owner: ctx.repository.owner,
    repo: ctx.repository.name,
    pullNumber,
    sha: currentSha,
    failedReviewIds: result.failed,
  });
}

function retireRiskReviewSession(channel: GitHubEventContext): void {
  channel.setContinuationToken(
    riskReviewRetirementToken({
      owner: channel.state.owner,
      repo: channel.state.repo,
      pullNumber: channel.state.pullRequestNumber,
      headSha: channel.state.headSha,
      nonce: crypto.randomUUID(),
    }),
  );
}
