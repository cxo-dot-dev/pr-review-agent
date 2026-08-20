import { describe, expect, it } from "vitest";
import { POLICY_VERSION } from "../agent/lib/config";
import { detectRiskArchetypes, RISK_CALIBRATION } from "../agent/lib/risk-calibration";

const file = (filename: string) => ({
  filename,
  status: "modified",
  additions: 10,
  deletions: 0,
  changes: 10,
});

describe("risk calibration context", () => {
  it("is versioned and keeps the clean internal-report anchor in low", () => {
    expect(RISK_CALIBRATION.version).toBe(POLICY_VERSION);
    expect(RISK_CALIBRATION.directive).toContain("supersedes prior-session ratings");
    expect(RISK_CALIBRATION.internalReadOnlyReportProfile).toEqual({
      changeComplexity: "low",
      blastRadius: "very_low",
      dataSecurity: "low",
      operationalRecovery: "low",
      verification: "low",
    });
  });

  it("detects documentation and internal-report candidates", () => {
    expect(detectRiskArchetypes([file("docs/changelog.md"), file("docs/changelog.html")])).toEqual([
      "documentation-only",
    ]);
    expect(
      detectRiskArchetypes([
        file("src/admin/reports/revenue/page.tsx"),
        file("src/lib/reports/revenue.ts"),
      ]),
    ).toContain("internal-report-candidate");
  });
});
