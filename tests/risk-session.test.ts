import { describe, expect, it } from "vitest";
import { POLICY_VERSION } from "../agent/lib/config";
import {
  isRiskReviewCompletion,
  riskReviewRetirementToken,
} from "../agent/lib/risk-session";

describe("risk review session retirement", () => {
  it("recognizes compact and narrative risk-review completion replies", () => {
    expect(isRiskReviewCompletion("Risk review published.")).toBe(true);
    expect(isRiskReviewCompletion("Risk review published for head SHA `abc123`.")).toBe(true);
    expect(isRiskReviewCompletion("Done.\nRisk review published.")).toBe(true);
    expect(isRiskReviewCompletion("Risk review complete for head SHA `abc123`.\n\n- Final score: 7/100")).toBe(true);
    expect(isRiskReviewCompletion("Risk review completed with no findings.")).toBe(true);
    expect(isRiskReviewCompletion("I reviewed the PR.")).toBe(false);
    expect(isRiskReviewCompletion(undefined)).toBe(false);
  });

  it("builds a policy-, head-, and nonce-scoped archival token", () => {
    expect(
      riskReviewRetirementToken({
        owner: "acme",
        repo: "example-app",
        pullNumber: 3578,
        headSha: "abc123",
        nonce: "test-nonce",
      }),
    ).toBe(
      `github-risk-retired:${POLICY_VERSION}:acme/example-app:3578:abc123:test-nonce`,
    );
  });
});
