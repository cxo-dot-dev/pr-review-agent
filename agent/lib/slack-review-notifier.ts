import { createHash } from "node:crypto";
import { connectSlackCredentials } from "@vercel/connect/eve";
import { callSlackApi } from "eve/channels/slack";
import { formatNeedsHumanGuidance } from "./blocker-guidance";
import { POLICY_VERSION, slackReviewConfig } from "./config";
import type { ApprovalDecision } from "./decision";
import { APPROVE_HANDOFF, decisionEmoji } from "./decision-presentation";
import type { FinalRisk } from "./risk-policy";
import type { PullRequestSnapshot } from "./types";

export type SlackReviewNotificationResult =
  | { status: "sent"; channelId: string; messageTs: string | null }
  | { status: "skipped"; reason: "channel_not_configured" | "changes_requested" }
  | { status: "failed"; reason: string };

export type SlackApiCaller = (input: {
  botToken: ReturnType<typeof connectSlackCredentials>["botToken"];
  operation: string;
  body: unknown;
}) => Promise<{ ok?: boolean; error?: unknown; ts?: unknown }>;

export interface SlackReviewNotificationInput {
  snapshot: PullRequestSnapshot;
  finalRisk: FinalRisk;
  decision: ApprovalDecision;
  summary: string;
  confidence: number;
}

export function reviewerMentions(
  _authorLogin: string,
  config: ReturnType<typeof slackReviewConfig> = slackReviewConfig(),
): readonly string[] {
  return config.reviewerIds.map((id) => `<@${id}>`);
}

export function renderSlackReviewNotification(
  input: SlackReviewNotificationInput,
  config: ReturnType<typeof slackReviewConfig> = slackReviewConfig(),
): string {
  const { snapshot, finalRisk, decision, summary, confidence } = input;
  const pullRequest = snapshot.pullRequest;
  const author = pullRequest.user.login;
  const mentions = reviewerMentions(author, config).join(" ");
  const url = `https://github.com/${snapshot.owner}/${snapshot.repo}/pull/${pullRequest.number}`;
  const label = `#${pullRequest.number} ${escapeSlackText(pullRequest.title)}`;
  const icon = decisionEmoji(decision, finalRisk.band);
  const heading = decision.disposition === "approve"
    ? `${icon} *Bot approved — human approval still required*`
    : decision.disposition === "request_changes"
      ? `${icon} *Changes requested*`
      : `${icon} *Human review required*`;
  const assignment = decision.disposition === "request_changes"
    ? "No reviewer handoff yet — the author needs to address the findings."
    : mentions.length === 0
      ? "Ready for a human reviewer."
    : reviewerMentions(author, config).length > 1
      ? `${mentions} — either of you can take this.`
      : `${mentions} — this one is ready for you.`;

  if (decision.disposition === "needs_human") {
    const guidance = formatNeedsHumanGuidance(decision.blockers, confidence);
    const blockedBy = [guidance.primary, ...guidance.additional]
      .map((item) => escapeSlackText(item.blockedBy))
      .join(" · ");
    return [
      heading,
      assignment,
      `<${url}|${label}> by \`@${escapeSlackText(author)}\``,
      `*TL;DR:* ${escapeSlackText(singleLine(summary))}`,
      `*Risk:* ${finalRisk.score}/100 ${titleCase(finalRisk.band)} · checks green`,
      `*Blocked by:* ${blockedBy}`,
      `*Next step:* ${escapeSlackText(guidance.primary.nextStep)}`,
    ].join("\n");
  }

  if (decision.disposition === "approve") {
    return [
      heading,
      assignment,
      `<${url}|${label}> by \`@${escapeSlackText(author)}\``,
      `*TL;DR:* ${escapeSlackText(singleLine(summary))}`,
      `*Risk:* ${finalRisk.score}/100 ${titleCase(finalRisk.band)} · checks green`,
      `*Why ${titleCase(finalRisk.band)}:* ${riskBandExplanation(finalRisk.band)}`,
      `*Next step:* ${escapeSlackText(APPROVE_HANDOFF.nextStep)}`,
    ].join("\n");
  }

  return [
    heading,
    assignment,
    `<${url}|${label}> by \`@${escapeSlackText(author)}\``,
    `*TL;DR:* ${escapeSlackText(singleLine(summary))}`,
    `*Risk:* ${finalRisk.score}/100 ${titleCase(finalRisk.band)} · checks green`,
    `*Why ${titleCase(finalRisk.band)}:* ${riskBandExplanation(finalRisk.band)}`,
    `PR Review Agent requested changes: ${decision.blockers.join(" · ")}.`,
  ].join("\n");
}

export async function notifySlackReviewReady(
  input: SlackReviewNotificationInput,
  options: {
    config?: ReturnType<typeof slackReviewConfig>;
    callApi?: SlackApiCaller;
  } = {},
): Promise<SlackReviewNotificationResult> {
  if (input.decision.disposition === "request_changes") {
    return { status: "skipped", reason: "changes_requested" };
  }
  const config = options.config ?? slackReviewConfig();
  if (!config.channelId) return { status: "skipped", reason: "channel_not_configured" };

  try {
    const { botToken } = connectSlackCredentials(config.connectorUid);
    const response = await (options.callApi ?? callSlackApi)({
      botToken,
      operation: "chat.postMessage",
      body: {
        channel: config.channelId,
        text: renderSlackReviewNotification(input, config),
        client_msg_id: deterministicClientMessageId(input.snapshot),
        unfurl_links: false,
        unfurl_media: false,
      },
    });
    if (response.ok !== true) {
      return { status: "failed", reason: String(response.error ?? "unknown Slack API error") };
    }
    return {
      status: "sent",
      channelId: config.channelId,
      messageTs: typeof response.ts === "string" ? response.ts : null,
    };
  } catch (error) {
    return { status: "failed", reason: error instanceof Error ? error.message : String(error) };
  }
}

export function deterministicClientMessageId(snapshot: PullRequestSnapshot): string {
  const source = [
    POLICY_VERSION,
    snapshot.owner,
    snapshot.repo,
    snapshot.pullRequest.number,
    snapshot.pullRequest.head.sha,
  ].join(":");
  const hex = createHash("sha256").update(source).digest("hex").slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = "8";
  const value = hex.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function escapeSlackText(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function singleLine(value: string): string {
  return value.trim().replace(/\s+/gu, " ");
}

function riskBandExplanation(band: FinalRisk["band"]): string {
  if (band === "low") return "Contained and readily reversible.";
  if (band === "medium") {
    return "Meaningful behavior can regress, but rollback is straightforward.";
  }
  return "A failure could have broad or hard-to-recover impact.";
}

function titleCase(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1).toLowerCase()}`;
}
