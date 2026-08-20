import { describe, expect, it } from "vitest";
import {
  formatBlockerGuidance,
  formatNeedsHumanGuidance,
  selectPrimaryBlocker,
} from "../agent/lib/blocker-guidance";

describe("blocker guidance", () => {
  it("maps each NEEDS HUMAN blocker family to a blocked-by label and next step", () => {
    expect(formatBlockerGuidance("1 unresolved review thread(s)", 0.99)).toEqual({
      blockedBy: "1 unresolved review thread",
      nextStep: "Resolve or reply to open review threads, then wait for a fresh risk assessment.",
    });
    expect(formatBlockerGuidance("assessment confidence is below policy", 0.82).blockedBy).toBe(
      "confidence 82% (needs 90%)",
    );
    expect(formatBlockerGuidance("risk is medium, not low", 0.99).blockedBy).toContain("MEDIUM");
    expect(formatBlockerGuidance("risk is high, not low", 0.99).nextStep).toContain("never bot-approved");
    expect(
      formatBlockerGuidance(
        "human-only surface: authentication, authorization, or tenant boundary",
        0.99,
      ).blockedBy,
    ).toBe("human-only: authentication, authorization, or tenant boundary");
    expect(
      formatBlockerGuidance(
        "autonomous reviewability limit: 76 reviewable files exceeds the 75-file autonomous review limit",
        0.99,
      ).nextStep,
    ).toContain("Split the PR");
    expect(formatBlockerGuidance("pull request has merge conflicts", 0.99).nextStep).toContain("Rebase");
    expect(formatBlockerGuidance("fork pull requests require human approval", 0.99).nextStep).toContain(
      "maintainer",
    );
    expect(
      formatBlockerGuidance("repository acme/other is not allowlisted", 0.99).nextStep,
    ).toContain("outside PR Review Agent");
  });

  it("prefers actionable PR-state blockers over risk-band blockers", () => {
    expect(
      selectPrimaryBlocker([
        "risk is medium, not low",
        "pull request has merge conflicts",
        "assessment confidence is below policy",
      ]),
    ).toBe("pull request has merge conflicts");

    const guidance = formatNeedsHumanGuidance(
      ["risk is medium, not low", "1 unresolved review thread(s)"],
      0.95,
    );
    expect(guidance.primary.blockedBy).toBe("1 unresolved review thread");
    expect(guidance.additional).toHaveLength(1);
    expect(guidance.additional[0]?.blockedBy).toContain("MEDIUM");
  });
});
