export const POLICY_VERSION = "2026-09-09.2";
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

function checkNames(name: string): readonly string[] {
  const value = process.env[name]?.trim();
  if (!value) return [];
  if (!value.startsWith("[") && !value.startsWith("{")) return csv(name, []);

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`${name} must be a valid JSON array of non-empty check names`);
  }
  if (
    !Array.isArray(parsed) ||
    !parsed.every((item): item is string => typeof item === "string" && item.trim().length > 0)
  ) {
    throw new Error(`${name} must be a JSON array of non-empty check names`);
  }
  return parsed.map((item: string) => item.trim());
}

function minimumConfidence(): number {
  const value = process.env.ENG_AGENT_MIN_CONFIDENCE;
  if (value === undefined) return 0.9;
  const parsed = Number(value);
  if (value.trim() === "" || !Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new Error("ENG_AGENT_MIN_CONFIDENCE must be a finite number between 0 and 1");
  }
  return parsed;
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

interface RepositoryPolicy {
  baseBranches: readonly string[];
  requiredSuccessChecks: readonly string[];
  allowedNeutralChecks: readonly string[];
  allowedSkippedChecks: readonly string[];
  minimumConfidence: number;
}

function repositoryPolicies(): ReadonlyMap<string, Partial<RepositoryPolicy>> {
  const name = "ENG_AGENT_REPOSITORY_POLICIES";
  const value = process.env[name]?.trim();
  if (!value) return new Map();
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`${name} must be a valid JSON object keyed by owner/repository`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${name} must be a JSON object keyed by owner/repository`);
  }

  const policies = new Map<string, Partial<RepositoryPolicy>>();
  for (const [repository, candidate] of Object.entries(parsed)) {
    const normalized = repository.trim().toLowerCase();
    if (!/^[^/\s]+\/[^/\s]+$/u.test(normalized) || policies.has(normalized)) {
      throw new Error(`${name} contains an invalid or duplicate repository: ${repository}`);
    }
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      throw new Error(`${name}[${repository}] must be a policy object`);
    }
    const policy: Partial<RepositoryPolicy> = {};
    for (const [key, setting] of Object.entries(candidate)) {
      if (key === "minimumConfidence") {
        if (typeof setting !== "number" || !Number.isFinite(setting) || setting < 0 || setting > 1) {
          throw new Error(`${name}[${repository}].${key} must be a finite number between 0 and 1`);
        }
        policy.minimumConfidence = setting;
      } else if (
        key === "baseBranches" || key === "requiredSuccessChecks" ||
        key === "allowedNeutralChecks" || key === "allowedSkippedChecks"
      ) {
        if (!Array.isArray(setting) || !setting.every(
          (item): item is string => typeof item === "string" && item.trim().length > 0,
        )) {
          throw new Error(`${name}[${repository}].${key} must be an array of non-empty strings`);
        }
        policy[key] = setting.map((item: string) => item.trim());
      } else {
        throw new Error(`${name}[${repository}] contains an unknown policy setting: ${key}`);
      }
    }
    policies.set(normalized, policy);
  }
  return policies;
}

export function runtimePolicy(repository?: string) {
  const policies = repositoryPolicies();
  const globalPolicy = {
    repositories: csv("ENG_AGENT_REPOSITORIES", []),
    baseBranches: csv("ENG_AGENT_BASE_BRANCHES", ["main"]),
    requiredSuccessChecks: checkNames("ENG_AGENT_REQUIRED_CHECKS"),
    allowedNeutralChecks: checkNames("ENG_AGENT_ALLOWED_NEUTRAL_CHECKS"),
    allowedSkippedChecks: checkNames("ENG_AGENT_ALLOWED_SKIPPED_CHECKS"),
    minimumConfidence: minimumConfidence(),
  } as const;
  // Overrides customize policy only; the original, case-sensitive allowlist
  // remains the sole activation control.
  if (!repository || !globalPolicy.repositories.includes(repository)) return globalPolicy;
  return { ...globalPolicy, ...policies.get(repository.trim().toLowerCase()) };
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
