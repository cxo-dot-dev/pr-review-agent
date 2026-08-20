import { POLICY_VERSION } from "./config";

const RISK_REVIEW_COMPLETION = /(?:^|\n)Risk review (?:published|complete(?:d)?)\b/i;

export function isRiskReviewCompletion(message: string | undefined): boolean {
  return Boolean(message && RISK_REVIEW_COMPLETION.test(message.trim()));
}

export function riskReviewRetirementToken(input: {
  owner: string;
  repo: string;
  pullNumber: number | null;
  headSha: string | null;
  nonce: string;
}): string {
  return [
    "github-risk-retired",
    POLICY_VERSION,
    `${input.owner}/${input.repo}`,
    input.pullNumber ?? "unknown-pr",
    input.headSha ?? "unknown-head",
    input.nonce,
  ].join(":");
}
