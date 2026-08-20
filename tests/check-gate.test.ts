import { describe, expect, it } from "vitest";
import { evaluateCheckGate } from "../agent/lib/check-gate";
import { RISK_CHECK_NAME } from "../agent/lib/config";

const policy = {
  requiredSuccessChecks: ["lint", "Vercel"],
  allowedNeutralChecks: ["Cursor Bugbot"],
  allowedSkippedChecks: ["Process Merged PR Documentation"],
};

describe("evaluateCheckGate", () => {
  it("accepts required successes and explicitly allowlisted terminal conclusions", () => {
    const result = evaluateCheckGate(
      [
        { id: 1, name: "lint", status: "completed", conclusion: "success" },
        { id: 2, name: "Vercel", status: "completed", conclusion: "success" },
        { id: 3, name: "Cursor Bugbot", status: "completed", conclusion: "neutral" },
        {
          id: 4,
          name: "Process Merged PR Documentation",
          status: "completed",
          conclusion: "skipped",
        },
        { id: 5, name: RISK_CHECK_NAME, status: "queued", conclusion: null },
      ],
      [],
      policy,
    );
    expect(result.ready).toBe(true);
    expect(result.blocking).toEqual([]);
  });

  it("fails closed when a required check is absent", () => {
    const result = evaluateCheckGate(
      [{ id: 1, name: "lint", status: "completed", conclusion: "success" }],
      [],
      policy,
    );
    expect(result.ready).toBe(false);
    expect(result.missing).toEqual(["Vercel"]);
  });

  it("blocks pending, failing, and unknown neutral checks", () => {
    const result = evaluateCheckGate(
      [
        { id: 1, name: "lint", status: "completed", conclusion: "success" },
        { id: 2, name: "Vercel", status: "in_progress", conclusion: null },
        { id: 3, name: "security", status: "completed", conclusion: "failure" },
        { id: 4, name: "mystery", status: "completed", conclusion: "neutral" },
      ],
      [],
      policy,
    );
    expect(result.ready).toBe(false);
    expect(result.pending).toContain("Vercel");
    expect(result.blocking).toContain("security (failure)");
    expect(result.blocking).toContain("mystery (unapproved neutral)");
  });

  it("uses the latest check run with a given name", () => {
    const result = evaluateCheckGate(
      [
        { id: 1, name: "lint", status: "completed", conclusion: "failure" },
        { id: 5, name: "lint", status: "completed", conclusion: "success" },
        { id: 2, name: "Vercel", status: "completed", conclusion: "success" },
      ],
      [],
      policy,
    );
    expect(result.ready).toBe(true);
  });
});
