import { describe, expect, it, vi } from "vitest";
import type { CheckGateResult } from "../agent/lib/check-gate";
import {
  checkGateFingerprint,
  checkGateNextStep,
  formatCheckGateWait,
  hasWaitingChecksComment,
  notifyWaitingOnChecks,
  waitingChecksMarker,
} from "../agent/lib/check-gate-guidance";
import type { GitHubRequester } from "../agent/lib/types";

const sha = "a".repeat(40);

function gate(overrides: Partial<CheckGateResult> = {}): CheckGateResult {
  return {
    ready: false,
    missing: [],
    pending: [],
    blocking: [],
    accepted: [],
    ...overrides,
  };
}

describe("check gate waiting guidance", () => {
  it("explains missing and pending checks without asking for a code fix", () => {
    const waiting = gate({ missing: ["Vercel"], pending: ["lint"] });
    const body = formatCheckGateWait(waiting, sha);

    expect(body).toContain("⏳ **PR Review Agent hasn't started**");
    expect(body).toContain("`aaaaaaa`");
    expect(body).toContain("**Waiting on:** Vercel (missing) · lint (pending)");
    expect(body).toContain(
      "**Next step:** Wait for the required checks to finish on this head. Review starts automatically when the check gate is green.",
    );
    expect(body).toContain(waitingChecksMarker(sha, waiting));
    expect(checkGateNextStep(waiting)).not.toContain("Fix the failing");
  });

  it("tells engineers to fix blocking checks", () => {
    const failed = gate({ blocking: ["lint (failure)"] });
    expect(formatCheckGateWait(failed, sha)).toContain("**Waiting on:** lint (failure)");
    expect(checkGateNextStep(failed)).toContain("Fix the failing or unapproved checks, then push or re-run them.");
  });

  it("prioritizes fixes when blocking is mixed with pending or missing checks", () => {
    const mixed = gate({ missing: ["Vercel"], blocking: ["lint (failure)"] });
    expect(checkGateNextStep(mixed)).toContain("Fix the failing or unapproved checks first");
    expect(checkGateFingerprint(mixed)).toBe("missing:Vercel|blocking:lint (failure)");
  });

  it("skips posting when the same SHA and fingerprint already have a comment", async () => {
    const waiting = gate({ pending: ["Vercel"] });
    const request: GitHubRequester = vi.fn(async () => [
      { body: `old note\n${waitingChecksMarker(sha, waiting)}` },
    ] as never);
    const posted: string[] = [];

    const result = await notifyWaitingOnChecks({
      request,
      post: async (body) => {
        posted.push(body);
      },
      owner: "acme",
      repo: "example-app",
      pullNumber: 42,
      sha,
      gate: waiting,
    });

    expect(result).toBe("skipped");
    expect(posted).toEqual([]);
    expect(hasWaitingChecksComment([{ body: waitingChecksMarker(sha, waiting) }], sha, waiting)).toBe(true);
  });

  it("posts once when no matching waiting comment exists", async () => {
    const waiting = gate({ missing: ["Vercel"] });
    const request: GitHubRequester = vi.fn(async () => [{ body: "unrelated comment" }] as never);
    const posted: string[] = [];

    const result = await notifyWaitingOnChecks({
      request,
      post: async (body) => {
        posted.push(body);
      },
      owner: "acme",
      repo: "example-app",
      pullNumber: 42,
      sha,
      gate: waiting,
    });

    expect(result).toBe("posted");
    expect(posted).toHaveLength(1);
    expect(posted[0]).toContain("Vercel (missing)");
    expect(posted[0]).toContain(waitingChecksMarker(sha, waiting));
  });

  it("does not post when the check gate is already ready", async () => {
    const result = await notifyWaitingOnChecks({
      request: vi.fn(),
      post: vi.fn(),
      owner: "acme",
      repo: "example-app",
      pullNumber: 42,
      sha,
      gate: gate({ ready: true, accepted: ["lint", "Vercel"] }),
    });
    expect(result).toBe("skipped");
  });
});
