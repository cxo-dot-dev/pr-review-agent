import { describe, expect, it } from "vitest";
import { evaluateCheckGate } from "../agent/lib/check-gate";
import { evaluateApprovalDecision } from "../agent/lib/decision";
import { calculatePolicyAssessment, type FinalRisk } from "../agent/lib/risk-policy";
import type { RiskFinding } from "../agent/lib/types";
import { snapshot } from "./fixtures";

const lowRisk: FinalRisk = {
  band: "low",
  dimensionPeak: "low",
  policyFloor: "very_low",
  confidenceBlocksApproval: false,
  promotedForFinding: null,
};

function decide(
  value = snapshot(),
  findings: readonly RiskFinding[] = [],
  finalRisk: FinalRisk = lowRisk,
) {
  const gate = evaluateCheckGate(value.checkRuns, value.statuses, {
    requiredSuccessChecks: ["lint", "Vercel"],
    allowedNeutralChecks: ["Cursor Bugbot"],
    allowedSkippedChecks: [],
  });
  return evaluateApprovalDecision({
    snapshot: value,
    checkGate: gate,
    finalRisk,
    findings,
    repositories: ["acme/example-app"],
    baseBranches: ["main"],
    minimumConfidence: 0.9,
    confidence: 0.99,
    policy: calculatePolicyAssessment(value.files),
  });
}

describe("automatic approval decision", () => {
  it("approves an exact eligible low-risk snapshot", () => {
    expect(decide()).toEqual({ disposition: "approve", blockers: [] });
  });

  it("also approves a very-low-risk snapshot when every gate passes", () => {
    const veryLowRisk = {
      ...lowRisk,
      band: "very_low",
      dimensionPeak: "very_low",
    } as const;
    expect(decide(snapshot(), [], veryLowRisk)).toEqual({ disposition: "approve", blockers: [] });
  });

  it("blocks unresolved or unverifiable review threads", () => {
    expect(decide(snapshot({ reviewThreads: { known: true, unresolved: 1 } })).disposition).toBe("needs_human");
    expect(decide(snapshot({ reviewThreads: { known: false, unresolved: 0 } })).disposition).toBe("needs_human");
  });

  it("blocks forks and active human change requests", () => {
    const fork = snapshot();
    fork.pullRequest.head.repo = { full_name: "outside/fork" };
    expect(decide(fork).disposition).toBe("needs_human");

    const changes = snapshot({
      reviews: [
        {
          id: 9,
          state: "CHANGES_REQUESTED",
          body: "Please fix this <!-- pr-review-agent:risk copied marker -->",
          commit_id: "a".repeat(40),
          submitted_at: new Date().toISOString(),
          user: { login: "reviewer", type: "User" },
        },
      ],
    });
    expect(decide(changes).blockers).toContain("an active changes-requested review exists");
  });

  it("uses each human reviewer's latest state", () => {
    const value = snapshot({
      reviews: [
        {
          id: 1,
          state: "CHANGES_REQUESTED",
          body: "Old",
          commit_id: "a".repeat(40),
          submitted_at: "2026-07-31T00:00:00Z",
          user: { login: "reviewer", type: "User" },
        },
        {
          id: 2,
          state: "APPROVED",
          body: "Fixed",
          commit_id: "a".repeat(40),
          submitted_at: "2026-07-31T01:00:00Z",
          user: { login: "reviewer", type: "User" },
        },
      ],
    });
    expect(decide(value).disposition).toBe("approve");
  });

  it("requires changes for a substantive finding instead of escalating a clean risk decision", () => {
    const finding = { severity: "medium", title: "Broken path", body: "This fails for active users." } as const;
    const mediumRisk = { ...lowRisk, band: "medium", promotedForFinding: "medium" } as const;

    expect(decide(snapshot(), [finding], mediumRisk)).toMatchObject({
      disposition: "request_changes",
      blockers: expect.arrayContaining(["a medium or high finding exists"]),
    });
  });

  it("requires a human for clean human-only and unreviewable changes", () => {
    const auth = snapshot({
      files: [{ filename: "src/lib/auth/session.ts", status: "modified", additions: 8, deletions: 2, changes: 10 }],
    });
    expect(decide(auth).disposition).toBe("needs_human");
    expect(decide(auth).blockers).toContain(
      "human-only surface: authentication, authorization, or tenant boundary",
    );

    const huge = snapshot({
      files: Array.from({ length: 76 }, (_, index) => ({
        filename: `src/features/chat-v2/module-${index}.ts`,
        status: "modified",
        additions: 150,
        deletions: 0,
        changes: 150,
      })),
    });
    expect(decide(huge).disposition).toBe("needs_human");
    expect(decide(huge).blockers.some((blocker) => blocker.includes("reviewability limit"))).toBe(true);
  });
});
