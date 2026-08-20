import { describe, expect, it, vi } from "vitest";
import { POLICY_VERSION } from "../agent/lib/config";
import {
  publishRiskAssessment,
  renderReviewBody,
  riskExternalId,
  riskMarker,
} from "../agent/lib/review-publisher";
import type { ApprovalDecision } from "../agent/lib/decision";
import type { PolicyAssessment } from "../agent/lib/risk-policy";
import type { GitHubRequester } from "../agent/lib/types";
import { snapshot } from "./fixtures";

function policy(overrides: Partial<PolicyAssessment> = {}): PolicyAssessment {
  return {
    riskFloor: "very_low",
    riskFlags: [],
    humanReviewRequirements: [],
    reviewability: {
      sufficient: true,
      reasons: [],
      reviewableChanges: 0,
      reviewableFiles: 0,
    },
    totalChanges: 4,
    changedFiles: 1,
    ...overrides,
  };
}

describe("risk publication", () => {
  it("binds the check and approval review to the exact SHA and policy", async () => {
    const calls: Array<{ method: string; path: string; body?: object }> = [];
    const request: GitHubRequester = vi.fn(async (method, path, body) => {
      calls.push({ method, path, ...(body ? { body } : {}) });
      return { id: path.includes("check-runs") ? 100 : 200 } as never;
    });
    const value = snapshot();
    const result = await publishRiskAssessment({
      request,
      snapshot: value,
      finalRisk: {
        band: "low",
        dimensionPeak: "low",
        policyFloor: "very_low",
        confidenceBlocksApproval: false,
        promotedForFinding: null,
      },
      policy: policy(),
      dimensions: {
        changeComplexity: "low",
        blastRadius: "very_low",
        dataSecurity: "very_low",
        operationalRecovery: "very_low",
        verification: "low",
      },
      confidence: 0.99,
      summary: "Small documentation correction.",
      evidence: [{ path: "docs/example.md", explanation: "Text only" }],
      findings: [],
      decision: { disposition: "approve", blockers: [] },
    });

    expect(result.reviewEvent).toBe("APPROVE");
    const checkBody = calls[0]?.body as Record<string, unknown>;
    expect(checkBody.head_sha).toBe("a".repeat(40));
    expect(checkBody.external_id).toBe(riskExternalId("a".repeat(40)));
    expect(checkBody.conclusion).toBe("success");
    const reviewBody = calls[1]?.body as Record<string, unknown>;
    expect(reviewBody.event).toBe("APPROVE");
    expect(reviewBody.commit_id).toBe("a".repeat(40));
    expect(String(reviewBody.body)).toContain(riskMarker("a".repeat(40), "APPROVE"));
    expect(String(reviewBody.body)).toContain(POLICY_VERSION);
    expect(String(reviewBody.body)).toContain("| Overall risk | Disposition | Confidence |");
    expect(String(reviewBody.body)).toContain("| **Low** | ✨ **APPROVE** | **99%** |");
    expect(String(reviewBody.body)).toContain(
      "> **Why approved:** Very low or low risk, sufficient confidence, and every approval gate passed.",
    );
    expect(String(reviewBody.body)).toContain(
      "> **Next step:** PR Review Agent cannot merge. GitHub still needs one qualifying human approval.",
    );
  });

  it.each([
    ["request_changes", "REQUEST_CHANGES", "action_required"],
    ["needs_human", "COMMENT", "neutral"],
  ] as const)("publishes %s with the matching GitHub review and check conclusion", async (
    disposition,
    expectedEvent,
    expectedConclusion,
  ) => {
    const calls: Array<{ method: string; path: string; body?: object }> = [];
    const request: GitHubRequester = vi.fn(async (method, path, body) => {
      calls.push({ method, path, ...(body ? { body } : {}) });
      return { id: path.includes("check-runs") ? 100 : 200 } as never;
    });
    const decision: ApprovalDecision = {
      disposition,
      blockers: disposition === "request_changes"
        ? ["a medium or high finding exists"]
        : ["risk is medium, not low"],
    };
    const value = snapshot();
    const result = await publishRiskAssessment({
      request,
      snapshot: value,
      finalRisk: {
        band: "medium",
        dimensionPeak: "medium",
        policyFloor: "low",
        confidenceBlocksApproval: false,
        promotedForFinding: disposition === "request_changes" ? "medium" : null,
      },
      policy: policy({ riskFloor: "low" }),
      dimensions: {
        changeComplexity: "medium",
        blastRadius: "medium",
        dataSecurity: "low",
        operationalRecovery: "low",
        verification: "medium",
      },
      confidence: 0.95,
      summary: "Changes reversible application behavior and needs a human decision.",
      evidence: [],
      findings: [],
      decision,
    });

    expect(result.reviewEvent).toBe(expectedEvent);
    expect(calls[0]?.body).toMatchObject({ conclusion: expectedConclusion });
    expect(calls[1]?.body).toMatchObject({ event: expectedEvent });
  });

  it("dismisses an earlier automated approval before publishing a non-approval", async () => {
    const calls: Array<{ method: string; path: string; body?: object }> = [];
    const request: GitHubRequester = vi.fn(async (method, path, body) => {
      calls.push({ method, path, ...(body ? { body } : {}) });
      return { id: path.includes("check-runs") ? 100 : 200 } as never;
    });
    const value = snapshot({
      reviews: [
        {
          id: 77,
          state: "APPROVED",
          body: `<!-- pr-review-agent:risk policy=2026-08-02.5 sha=${"a".repeat(40)} decision=APPROVE -->`,
          commit_id: "a".repeat(40),
          submitted_at: "2026-08-02T00:00:00Z",
          user: { login: "pr-review-agent[bot]", type: "Bot" },
        },
      ],
    });

    await publishRiskAssessment({
      request,
      snapshot: value,
      finalRisk: {
        band: "medium",
        dimensionPeak: "medium",
        policyFloor: "low",
        confidenceBlocksApproval: false,
        promotedForFinding: null,
      },
      policy: policy({ riskFloor: "low" }),
      dimensions: {
        changeComplexity: "medium",
        blastRadius: "medium",
        dataSecurity: "low",
        operationalRecovery: "low",
        verification: "medium",
      },
      confidence: 0.95,
      summary: "Changes reversible application behavior and needs a human decision.",
      evidence: [],
      findings: [],
      decision: { disposition: "needs_human", blockers: ["risk is medium, not low"] },
    });

    expect(calls[0]).toMatchObject({
      method: "PUT",
      path: "/repos/acme/example-app/pulls/42/reviews/77/dismissals",
    });
    expect(calls[1]?.body).toMatchObject({ conclusion: "neutral" });
    expect(calls[2]?.body).toMatchObject({ event: "COMMENT" });
  });

  it("renders a compact scan-first review with details collapsed", () => {
    const value = snapshot();
    const summary =
      "This read-only internal report can misstate an admin chart, but it cannot mutate billing data and is immediately recoverable by reverting the change.";
    const body = renderReviewBody({
      request: vi.fn(),
      snapshot: value,
      finalRisk: {
        band: "low",
        dimensionPeak: "low",
        policyFloor: "low",
        confidenceBlocksApproval: true,
        promotedForFinding: "low",
      },
      policy: policy({ riskFloor: "low", totalChanges: 739, changedFiles: 6 }),
      dimensions: {
        changeComplexity: "low",
        blastRadius: "very_low",
        dataSecurity: "low",
        operationalRecovery: "low",
        verification: "low",
      },
      confidence: 0.82,
      summary,
      evidence: [{ path: "src/admin/reports/revenue/page.tsx", explanation: "Admin-only presentation." }],
      findings: [
        {
          severity: "low",
          title: "Week labels omit the year",
          body: "Use an ISO date as the bucket key and format it only for display.",
          path: "src/lib/reports/revenue-outcomes.ts",
          line: 230,
        },
      ],
      decision: {
        disposition: "needs_human",
        blockers: ["1 unresolved review thread(s)", "assessment confidence is below policy"],
      },
    }, "COMMENT");
    expect(body).toContain("| Overall risk | Disposition | Confidence |");
    expect(body).toContain("| **Low** | 💬 **NEEDS HUMAN** | **82%** |");
    expect(body).toContain("| Operational and recovery | Low |");
    expect(body).toContain("Aggregation: highest consequential rating wins");
    expect(body).toContain("> **Why human review is required:** 1 unresolved review thread");
    expect(body).toContain(
      "> **What blocked auto-approval:** 1 unresolved review thread · confidence 82% (needs 90%)",
    );
    expect(body).toContain(
      "> **Next step:** Resolve or reply to open review threads, then wait for a fresh risk assessment.",
    );
    expect(body).toContain(`**Summary:** ${summary}`);
    expect(body).not.toContain(`**Summary:** ${summary.slice(0, -1)}…`);
    expect(body).toContain("<summary>Review details · 1 low finding(s)</summary>");
    expect(body.indexOf("<details>")).toBeLessThan(body.indexOf("#### Review notes"));
    expect(body).not.toContain("### Deterministic policy flags");
    expect(body.split("\n").length).toBeLessThanOrEqual(45);
  });

  it("renders human-only NEEDS HUMAN with a concrete next step", () => {
    const body = renderReviewBody({
      request: vi.fn(),
      snapshot: snapshot(),
      finalRisk: {
        band: "low",
        dimensionPeak: "low",
        policyFloor: "low",
        confidenceBlocksApproval: false,
        promotedForFinding: null,
      },
      policy: policy({
        humanReviewRequirements: [
          {
            code: "authentication-authorization-or-tenant-boundary",
            reason: "authentication, authorization, or tenant boundary",
            paths: ["src/lib/auth/session.ts"],
          },
        ],
      }),
      dimensions: {
        changeComplexity: "low",
        blastRadius: "very_low",
        dataSecurity: "low",
        operationalRecovery: "low",
        verification: "low",
      },
      confidence: 0.97,
      summary: "Touches session auth helpers without mutating billing.",
      evidence: [],
      findings: [],
      decision: {
        disposition: "needs_human",
        blockers: ["human-only surface: authentication, authorization, or tenant boundary"],
      },
    }, "COMMENT");

    expect(body).toContain(
      "> **Why human review is required:** human-only: authentication, authorization, or tenant boundary",
    );
    expect(body).toContain(
      "> **Next step:** Request review from an owner of this surface; the bot cannot auto-approve these paths.",
    );
    expect(body).not.toContain("**What blocked auto-approval:**");
  });
});
