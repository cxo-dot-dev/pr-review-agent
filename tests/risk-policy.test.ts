import { describe, expect, it } from "vitest";
import { calculateFinalRisk, calculatePolicyAssessment, riskBand } from "../agent/lib/risk-policy";

const file = (filename: string, changes = 10) => ({
  filename,
  status: "modified",
  additions: changes,
  deletions: 0,
  changes,
});

const lowDimensions = {
  changeSurface: 3,
  blastRadius: 2,
  reversibility: 1,
  dataSecurity: 0,
  operationalRisk: 1,
  verificationGap: 2,
};

describe("risk policy", () => {
  it("keeps a small docs-only diff eligible for low risk", () => {
    const policy = calculatePolicyAssessment([file("docs/guide.md")]);
    expect(policy.riskFloor).toBe(5);
    expect(calculateFinalRisk({
      dimensions: lowDimensions,
      confidence: 0.98,
      findings: [],
      policy,
      minimumConfidence: 0.9,
    })).toMatchObject({ score: 9, band: "low" });
  });

  it.each([
    "prisma/migrations/20260801_add_tenant/migration.sql",
    ".github/workflows/deploy.yml",
    "src/api/payments/cancel-subscription.ts",
    "src/webhooks/identity/account-sync.ts",
  ])("sets a high floor for %s", (path) => {
    const policy = calculatePolicyAssessment([file(path)]);
    expect(policy.riskFloor).toBeGreaterThanOrEqual(70);
    expect(policy.humanReviewRequirements).not.toHaveLength(0);
  });

  it("sets a medium floor for dependency and server behavior", () => {
    expect(calculatePolicyAssessment([file("package.json")]).riskFloor).toBe(35);
    expect(calculatePolicyAssessment([file("src/app/api/items/route.ts")]).riskFloor).toBe(35);
  });

  it("keeps confidence separate from risk while medium findings promote the band", () => {
    const policy = calculatePolicyAssessment([file("docs/guide.md")]);
    const confidence = calculateFinalRisk({
      dimensions: lowDimensions,
      confidence: 0.7,
      findings: [],
      policy,
      minimumConfidence: 0.9,
    });
    const finding = calculateFinalRisk({
      dimensions: lowDimensions,
      confidence: 0.99,
      findings: [{ severity: "medium", title: "Gap", body: "Missing coverage" }],
      policy,
      minimumConfidence: 0.9,
    });
    expect(confidence).toMatchObject({ band: "low", confidenceBlocksApproval: true });
    expect(finding.band).toBe("medium");
  });

  it("keeps a clean internal read-only report below medium", () => {
    const files = [
      file("src/admin/reports/revenue/page.tsx", 124),
      file("src/admin/reports/revenue/Charts.tsx", 94),
      file("src/lib/reports/revenue.ts", 70),
      file("src/lib/reports/revenue-outcomes.ts", 242),
      file("src/lib/reports/revenue.test.ts", 166),
      file("docs/features/revenue-dashboard.md", 43),
    ];
    expect(calculatePolicyAssessment(files)).toMatchObject({
      riskFloor: 12,
      riskFlags: [],
      humanReviewRequirements: [],
    });
  });

  it("does not size-promote generated docs or changelog batches", () => {
    const files = Array.from({ length: 35 }, (_, index) => file(`docs/generated-${index}.html`, 120));
    expect(calculatePolicyAssessment(files)).toMatchObject({
      riskFloor: 5,
      riskFlags: [],
      reviewability: { sufficient: true, reviewableFiles: 0, reviewableChanges: 0 },
    });
  });

  it("keeps sensitive paths human-only without using size as a risk proxy", () => {
    const authorization = calculatePolicyAssessment([file("src/lib/authorization/policy.ts")]);
    const authentication = calculatePolicyAssessment([file("src/lib/auth/session.ts")]);
    expect(authorization.riskFloor).toBe(45);
    expect(authentication.riskFloor).toBe(45);
    expect(authorization.humanReviewRequirements[0]?.reason).toContain("authentication");
    expect(authentication.humanReviewRequirements[0]?.reason).toContain("authentication");

    const broad = Array.from({ length: 26 }, (_, index) => file(`src/features/chat-v2/module-${index}.ts`, 75));
    expect(calculatePolicyAssessment(broad)).toMatchObject({
      riskFloor: 12,
      riskFlags: [],
      reviewability: { sufficient: true },
    });
  });

  it("blocks autonomous review when the reviewable diff exceeds the attention cap", () => {
    const huge = Array.from({ length: 76 }, (_, index) =>
      file(`src/features/chat-v2/module-${index}.ts`, 150),
    );
    expect(calculatePolicyAssessment(huge)).toMatchObject({
      riskFloor: 12,
      reviewability: {
        sufficient: false,
        reviewableFiles: 76,
        reviewableChanges: 11_400,
      },
    });
  });

  it("makes approval-policy and governance changes human-only", () => {
    for (const path of [
      "agent/lib/decision.ts",
      "agent/skills/pr-risk-review/SKILL.md",
      ".github/CODEOWNERS",
    ]) {
      expect(calculatePolicyAssessment([file(path)]).humanReviewRequirements).toEqual([
        expect.objectContaining({ reason: "approval policy or governance" }),
      ]);
    }
  });

  it.each([
    "src/lib/server-auth-context.ts",
    "src/lib/documents/access.ts",
    "src/lib/features/tier-access.ts",
    "src/actions/payments/checkout.ts",
    "src/actions/subscriptions/cancel.ts",
    "src/workers/identity/account-sync.ts",
    "src/lib/messages/message-parts-backfill.ts",
  ])("requires human review for a generic sensitive surface %s", (path) => {
    expect(calculatePolicyAssessment([file(path)]).humanReviewRequirements).not.toHaveLength(0);
  });

  it("does not make tests for sensitive code human-only", () => {
    const policy = calculatePolicyAssessment([file("src/lib/auth/session.test.ts", 300)]);
    expect(policy).toMatchObject({
      riskFloor: 8,
      humanReviewRequirements: [],
      reviewability: { sufficient: true, reviewableFiles: 0, reviewableChanges: 0 },
    });
  });

  it("does not path-promote ordinary frontend polish", () => {
    expect(calculatePolicyAssessment([file("src/components/onboarding/Hero.tsx", 80)])).toMatchObject({
      riskFloor: 12,
      riskFlags: [],
    });
  });

  it("promotes high findings to high and applies stable band boundaries", () => {
    const result = calculateFinalRisk({
      dimensions: lowDimensions,
      confidence: 0.99,
      findings: [{ severity: "high", title: "Data loss", body: "Deletes records" }],
      policy: calculatePolicyAssessment([file("docs/guide.md")]),
      minimumConfidence: 0.9,
    });
    expect(result.band).toBe("high");
    expect(riskBand(24)).toBe("low");
    expect(riskBand(25)).toBe("medium");
    expect(riskBand(64)).toBe("medium");
    expect(riskBand(65)).toBe("high");
  });
});
