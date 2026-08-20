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

function repositoryReviewerGroups(name: string): Readonly<Record<string, string>> {
  const value = process.env[name]?.trim();
  if (!value) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed)
        .filter((entry): entry is [string, string] => {
          const repository = entry[0].trim();
          return (
            /^[^/\s]+\/[^/\s]+$/u.test(repository) &&
            typeof entry[1] === "string" &&
            /^S[A-Z0-9]+$/u.test(entry[1].trim())
          );
        })
        .map(([repository, groupId]) => [repository.trim().toLowerCase(), groupId.trim()]),
    );
  } catch {
    return {};
  }
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
    reviewerGroupId: process.env.ENG_AGENT_SLACK_REVIEWER_GROUP_ID?.trim() ?? "",
    repositoryReviewerGroupIds: repositoryReviewerGroups(
      "ENG_AGENT_SLACK_REPOSITORY_REVIEWER_GROUPS",
    ),
  } as const;
}
