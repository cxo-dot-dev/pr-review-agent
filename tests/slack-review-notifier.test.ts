import { afterEach, describe, expect, it, vi } from "vitest";
import { slackReviewConfig } from "../agent/lib/config";
import type { ApprovalDecision } from "../agent/lib/decision";
import type { FinalRisk } from "../agent/lib/risk-policy";
import {
  deterministicClientMessageId,
  notifySlackReviewReady,
  renderSlackReviewNotification,
  reviewerGroupMention,
  type SlackApiCaller,
} from "../agent/lib/slack-review-notifier";
import { snapshot } from "./fixtures";

const config = {
  connectorUid: "slack/pr-review-agent",
  channelId: "C_REVIEW",
  reviewerGroupId: "SGLOBAL",
  repositoryReviewerGroupIds: { "acme/example-app": "SAPPTEAM" },
} as const;

const lowRisk: FinalRisk = {
  band: "low",
  dimensionPeak: "low",
  policyFloor: "low",
  confidenceBlocksApproval: false,
  promotedForFinding: "low",
};

const approved: ApprovalDecision = { disposition: "approve", blockers: [] };
const summary =
  "Filters noisy browser telemetry without changing application behavior; reverting restores the prior reporting only.";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Slack PR review notifications", () => {
  it("routes by repository user group with a global fallback", () => {
    expect(reviewerGroupMention("acme/example-app", config)).toBe("<!subteam^SAPPTEAM>");
    expect(reviewerGroupMention("acme/other-app", config)).toBe("<!subteam^SGLOBAL>");
    expect(reviewerGroupMention("acme/other-app", {
      ...config,
      reviewerGroupId: "",
      repositoryReviewerGroupIds: {},
    })).toBe("");
  });

  it("normalizes repository group configuration and drops malformed entries", () => {
    vi.stubEnv("ENG_AGENT_SLACK_REVIEWER_GROUP_ID", "SGLOBAL");
    vi.stubEnv(
      "ENG_AGENT_SLACK_REPOSITORY_REVIEWER_GROUPS",
      JSON.stringify({
        "Acme/Example-App": " SAPPTEAM ",
        invalid: "SNOOWNER",
        "acme/unsafe": "<!channel>",
      }),
    );

    expect(slackReviewConfig()).toMatchObject({
      reviewerGroupId: "SGLOBAL",
      repositoryReviewerGroupIds: { "acme/example-app": "SAPPTEAM" },
    });
  });

  it("fails safely when repository group configuration is not JSON", () => {
    vi.stubEnv("ENG_AGENT_SLACK_REPOSITORY_REVIEWER_GROUPS", "not-json");

    expect(slackReviewConfig().repositoryReviewerGroupIds).toEqual({});
  });

  it("renders a concise low-risk approve-and-merge handoff without claiming the bot unlocks merge", () => {
    const value = snapshot({
      pullRequest: {
        ...snapshot().pullRequest,
        number: 3559,
        title: "Filter DoubleClick noise",
        user: { login: "engineer", type: "User" },
      },
    });
    const message = renderSlackReviewNotification(
      { snapshot: value, finalRisk: lowRisk, decision: approved, summary, confidence: 0.99 },
      config,
    );

    expect(message).toContain("✨ *Bot approved — human approval still required*");
    expect(message).toContain(
      "<!subteam^SAPPTEAM> — review requested; GitHub remains the source of truth for ownership.",
    );
    expect(message).toContain("<https://github.com/acme/example-app/pull/3559|#3559 Filter DoubleClick noise>");
    expect(message).toContain(`*TL;DR:* ${summary}`);
    expect(message).toContain("*Risk:* Low · checks green");
    expect(message).toContain("*Why Low:* Contained and readily reversible.");
    expect(message).toContain(
      "*Next step:* PR Review Agent cannot merge. GitHub still needs one qualifying human approval.",
    );
    expect(message).not.toContain("Ready to approve + merge");
  });

  it("renders medium and high decisions as human review required", () => {
    const message = renderSlackReviewNotification(
      {
        snapshot: snapshot(),
        finalRisk: { ...lowRisk, band: "medium", dimensionPeak: "medium" },
        decision: { disposition: "needs_human", blockers: ["risk is medium, not low"] },
        summary: "Deletes retired Chat V1 code and inert API stubs; reverting restores the removed paths.",
        confidence: 0.95,
      },
      config,
    );

    expect(message).toContain("🧭 *Human review required*");
    expect(message).toContain(
      "*TL;DR:* Deletes retired Chat V1 code and inert API stubs; reverting restores the removed paths.",
    );
    expect(message).toContain("*Blocked by:* risk is MEDIUM (only LOW can auto-approve)");
    expect(message).toContain(
      "*Next step:* Ask a qualified reviewer to approve; the change is clean but not bot-eligible.",
    );
    expect(message).not.toContain("*Why Medium:*");
    expect(message).not.toContain("PR Review Agent needs a human decision:");
  });

  it("uses blocker-specific emojis for low-risk human review", () => {
    const mergeConflict = renderSlackReviewNotification(
      {
        snapshot: snapshot(),
        finalRisk: lowRisk,
        decision: { disposition: "needs_human", blockers: ["pull request has merge conflicts"] },
        summary,
        confidence: 0.99,
      },
      config,
    );
    const lowConfidence = renderSlackReviewNotification(
      {
        snapshot: snapshot(),
        finalRisk: lowRisk,
        decision: { disposition: "needs_human", blockers: ["assessment confidence is below policy"] },
        summary,
        confidence: 0.82,
      },
      config,
    );

    expect(mergeConflict).toContain("🚧 *Human review required*");
    expect(mergeConflict).toContain("*Blocked by:* pull request has merge conflicts");
    expect(mergeConflict).toContain("*Next step:* Rebase or merge the base branch, resolve conflicts, and push.");
    expect(lowConfidence).toContain("🔎 *Human review required*");
    expect(lowConfidence).toContain("*Blocked by:* confidence 82% (needs 90%)");
  });

  it("uses an alert for high-risk review", () => {
    const message = renderSlackReviewNotification(
      {
        snapshot: snapshot(),
        finalRisk: { ...lowRisk, band: "high", dimensionPeak: "high" },
        decision: { disposition: "needs_human", blockers: ["risk is high, not low"] },
        summary,
        confidence: 0.95,
      },
      config,
    );

    expect(message).toContain("🚨 *Human review required*");
    expect(message).toContain("*Blocked by:* risk is HIGH (only LOW can auto-approve)");
    expect(message).toContain("*Next step:* Ask a senior/qualified reviewer to approve");
  });

  it("uses an exact-SHA deterministic client message id", () => {
    const first = deterministicClientMessageId(snapshot());
    const second = deterministicClientMessageId(snapshot());
    const moved = deterministicClientMessageId(snapshot({
      pullRequest: { ...snapshot().pullRequest, head: { ...snapshot().pullRequest.head, sha: "c".repeat(40) } },
    }));

    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/u);
    expect(second).toBe(first);
    expect(moved).not.toBe(first);
  });

  it("keeps changes-requested PRs out of the reviewer-ready Slack channel", async () => {
    const callApi = vi.fn();
    const result = await notifySlackReviewReady(
      {
        snapshot: snapshot(),
        finalRisk: { ...lowRisk, band: "medium", dimensionPeak: "medium" },
        decision: {
          disposition: "request_changes",
          blockers: ["a medium or high finding exists"],
        },
        summary,
        confidence: 0.95,
      },
      { config, callApi },
    );

    expect(result).toEqual({ status: "skipped", reason: "changes_requested" });
    expect(callApi).not.toHaveBeenCalled();
  });

  it("skips delivery until a review channel is configured", async () => {
    const result = await notifySlackReviewReady(
      { snapshot: snapshot(), finalRisk: lowRisk, decision: approved, summary, confidence: 0.99 },
      { config: { ...config, channelId: "" } },
    );

    expect(result).toEqual({ status: "skipped", reason: "channel_not_configured" });
  });

  it("posts a channel-only handoff when no reviewer group is configured", () => {
    const message = renderSlackReviewNotification(
      { snapshot: snapshot(), finalRisk: lowRisk, decision: approved, summary, confidence: 0.99 },
      { ...config, reviewerGroupId: "", repositoryReviewerGroupIds: {} },
    );

    expect(message).toContain(
      "Ready for human review — see GitHub review requests and CODEOWNERS for ownership.",
    );
    expect(message).not.toContain("<!subteam^");
  });

  it("posts once with the configured channel and deterministic id", async () => {
    const callApi = vi.fn(async (_input: Parameters<SlackApiCaller>[0]) => ({
      ok: true,
      ts: "123.456",
    }));
    const value = snapshot();
    const result = await notifySlackReviewReady(
      { snapshot: value, finalRisk: lowRisk, decision: approved, summary, confidence: 0.99 },
      { config, callApi },
    );

    expect(result).toEqual({ status: "sent", channelId: config.channelId, messageTs: "123.456" });
    expect(callApi).toHaveBeenCalledOnce();
    expect(callApi.mock.calls[0]?.[0]).toMatchObject({
      operation: "chat.postMessage",
      body: {
        channel: config.channelId,
        client_msg_id: deterministicClientMessageId(value),
        unfurl_links: false,
        unfurl_media: false,
      },
    });
  });

  it("does not roll back the GitHub decision when Slack fails", async () => {
    const result = await notifySlackReviewReady(
      { snapshot: snapshot(), finalRisk: lowRisk, decision: approved, summary, confidence: 0.99 },
      { config, callApi: vi.fn(async () => ({ ok: false, error: "not_in_channel" })) },
    );

    expect(result).toEqual({ status: "failed", reason: "not_in_channel" });
  });
});
