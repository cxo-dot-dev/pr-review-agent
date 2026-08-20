export const POLICY_VERSION = "2026-08-20.1";
export const REVIEW_SUMMARY_MAX_LENGTH = 180;
export const RISK_CHECK_NAME = "PR Review Agent / risk";
export const RISK_MARKER_PREFIX = "<!-- pr-review-agent:risk";

function csv(name: string, fallback: readonly string[]): readonly string[] {
  const value = process.env[name];
  if (!value) return fallback;
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function runtimePolicy() {
  return {
    repositories: csv("ENG_AGENT_REPOSITORIES", []),
    baseBranches: csv("ENG_AGENT_BASE_BRANCHES", ["main"]),
    requiredSuccessChecks: csv("ENG_AGENT_REQUIRED_CHECKS", []),
    allowedNeutralChecks: csv("ENG_AGENT_ALLOWED_NEUTRAL_CHECKS", []),
    allowedSkippedChecks: csv("ENG_AGENT_ALLOWED_SKIPPED_CHECKS", []),
    minimumConfidence: Number(process.env.ENG_AGENT_MIN_CONFIDENCE ?? "0.9"),
  } as const;
}

export function githubConnectorUid(): string {
  return process.env.ENG_AGENT_GITHUB_CONNECTOR ?? "github/pr-review-agent";
}

export function slackReviewConfig() {
  return {
    connectorUid: process.env.ENG_AGENT_SLACK_CONNECTOR ?? "slack/pr-review-agent",
    channelId: process.env.ENG_AGENT_SLACK_REVIEW_CHANNEL?.trim() ?? "",
    reviewerIds: csv("ENG_AGENT_SLACK_REVIEWER_IDS", []),
  } as const;
}
