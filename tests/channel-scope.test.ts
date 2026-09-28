import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { snapshot } from "./fixtures";

vi.mock("eve/channels/github", () => ({
  githubChannel: (options: unknown) => options,
  defaultGitHubAuth: () => ({ authenticated: true }),
}));
vi.mock("eve/tools", () => ({ defineTool: (options: unknown) => options }));
vi.mock("eve/tools/approval", () => ({ never: () => ({}) }));
vi.mock("../agent/lib/github-credentials", () => ({ githubCredentials: {} }));
vi.mock("../agent/lib/github-api", () => ({
  loadPullRequestSnapshot: vi.fn(),
  authenticatedGitHubRequester: vi.fn(),
}));

import channel from "../agent/channels/github-pr";
import contextTool from "../agent/tools/get_pr_risk_context";
import { authenticatedGitHubRequester, loadPullRequestSnapshot } from "../agent/lib/github-api";

const handlers = channel as unknown as {
  onPullRequest(ctx: unknown, event: unknown): Promise<unknown>;
  onCheckSuite(ctx: unknown, suite: unknown): Promise<unknown>;
};
const tool = contextTool as unknown as {
  execute(input: object, ctx: unknown): Promise<unknown>;
};

function context() {
  return {
    repository: { fullName: "acme/example-app", owner: "acme", name: "example-app" },
    github: { request: vi.fn() },
    thread: { post: vi.fn() },
    session: { auth: { current: { attributes: {
      repository: "acme/example-app", pull_request_number: "42",
    } } } },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const name of [
    "ENG_AGENT_REPOSITORIES", "ENG_AGENT_REPOSITORY_POLICIES", "ENG_AGENT_BASE_BRANCHES",
    "ENG_AGENT_REQUIRED_CHECKS", "ENG_AGENT_ALLOWED_NEUTRAL_CHECKS",
    "ENG_AGENT_ALLOWED_SKIPPED_CHECKS", "ENG_AGENT_MIN_CONFIDENCE",
  ]) vi.stubEnv(name, undefined);
});
afterEach(() => vi.unstubAllEnvs());

describe.each([undefined, "acme/other-app"])("repository scope with allowlist %s", (allowlist) => {
  beforeEach(() => vi.stubEnv("ENG_AGENT_REPOSITORIES", allowlist));

  it.each(["synchronize", "converted_to_draft", "closed", "ready_for_review", "reopened"])
    ("ignores %s PR events without GitHub requests or posts", async (action) => {
      const ctx = context();
      expect(await handlers.onPullRequest(ctx, {
        action, pullRequestNumber: 42, headSha: "a".repeat(40),
      })).toBeNull();
      expect(ctx.github.request).not.toHaveBeenCalled();
      expect(ctx.thread.post).not.toHaveBeenCalled();
      expect(loadPullRequestSnapshot).not.toHaveBeenCalled();
    });

  it.each([
    ["requested", null], ["rerequested", null], ["completed", "failure"], ["completed", "success"],
  ])("ignores %s/%s check suites without GitHub requests or posts", async (action, conclusion) => {
    const ctx = context();
    expect(await handlers.onCheckSuite(ctx, {
      action, conclusion, pullRequests: [42], headSha: "a".repeat(40), app: { slug: "ci" },
    })).toBeNull();
    expect(ctx.github.request).not.toHaveBeenCalled();
    expect(ctx.thread.post).not.toHaveBeenCalled();
    expect(loadPullRequestSnapshot).not.toHaveBeenCalled();
  });

  it("blocks context loading before obtaining credentials", async () => {
    expect(await tool.execute({}, context())).toEqual({
      status: "blocked", reason: "Repository acme/example-app is not allowlisted.",
    });
    expect(authenticatedGitHubRequester).not.toHaveBeenCalled();
    expect(loadPullRequestSnapshot).not.toHaveBeenCalled();
  });
});

describe("allowlisted repository policy", () => {
  beforeEach(() => {
    vi.stubEnv("ENG_AGENT_REPOSITORIES", "acme/example-app");
    vi.stubEnv("ENG_AGENT_REQUIRED_CHECKS", "global-only-check");
    vi.stubEnv("ENG_AGENT_REPOSITORY_POLICIES", JSON.stringify({
      "acme/example-app": {
        baseBranches: ["develop"], requiredSuccessChecks: ["lint"],
        allowedSkippedChecks: ["optional"], minimumConfidence: 0.97,
      },
    }));
    const value = snapshot();
    value.pullRequest.base.ref = "develop";
    value.checkRuns = [...value.checkRuns, { id: 3, name: "optional", status: "completed", conclusion: "skipped" }];
    vi.mocked(loadPullRequestSnapshot).mockResolvedValue(value);
  });

  it("dispatches using the repository's base branch and check rules", async () => {
    const ctx = context();
    expect(await handlers.onPullRequest(ctx, {
      action: "ready_for_review", pullRequestNumber: 42,
    })).toMatchObject({ auth: { authenticated: true }, context: expect.any(Array) });
    expect(loadPullRequestSnapshot).toHaveBeenCalledWith(expect.any(Function), "acme", "example-app", 42);
    expect(ctx.thread.post).not.toHaveBeenCalled();
  });

  it("exposes repository-specific check and confidence settings in risk context", async () => {
    expect(await tool.execute({}, context())).toMatchObject({
      checkGate: { ready: true, missing: [], blocking: [] },
      policy: { minimumConfidence: 0.97 },
    });
    expect(authenticatedGitHubRequester).toHaveBeenCalledOnce();
  });
});
