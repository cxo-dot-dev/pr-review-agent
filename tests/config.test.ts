import { afterEach, describe, expect, it, vi } from "vitest";
import { runtimePolicy } from "../agent/lib/config";

const checkLists = [
  ["ENG_AGENT_REQUIRED_CHECKS", "requiredSuccessChecks"],
  ["ENG_AGENT_ALLOWED_NEUTRAL_CHECKS", "allowedNeutralChecks"],
  ["ENG_AGENT_ALLOWED_SKIPPED_CHECKS", "allowedSkippedChecks"],
] as const;

afterEach(() => vi.unstubAllEnvs());

describe("runtimePolicy check names", () => {
  for (const [environmentName, policyKey] of checkLists) {
    it(`preserves CSV compatibility for ${environmentName}`, () => {
      vi.stubEnv(environmentName, " lint, test ,,build ");
      expect(runtimePolicy()[policyKey]).toEqual(["lint", "test", "build"]);
    });

    it(`accepts exact names containing commas for ${environmentName}`, () => {
      vi.stubEnv(environmentName, '["Lint, Typecheck & Test", " Build "]');
      expect(runtimePolicy()[policyKey]).toEqual(["Lint, Typecheck & Test", "Build"]);
    });

    it.each([undefined, "", "  ", "[]"])(`allows an empty ${environmentName}: %s`, (value) => {
      vi.stubEnv(environmentName, value);
      expect(runtimePolicy()[policyKey]).toEqual([]);
    });

    it.each(['["lint",', '{"check":"lint"}', '["lint", null]', '["lint", 42]', '[""]', '[" "]'])
      (`rejects invalid ${environmentName}: %s`, (value) => {
        vi.stubEnv(environmentName, value);
        expect(() => runtimePolicy()).toThrow(environmentName);
      });
  }

  it("keeps automatic review disabled without a repository allowlist", () => {
    vi.stubEnv("ENG_AGENT_REPOSITORIES", undefined);
    expect(runtimePolicy().repositories).toEqual([]);
  });
});

describe("runtimePolicy confidence", () => {
  it("defaults to 0.9 when unset", () => {
    vi.stubEnv("ENG_AGENT_MIN_CONFIDENCE", undefined);
    expect(runtimePolicy().minimumConfidence).toBe(0.9);
  });

  it.each(["0", "0.95", "1"])("accepts %s", (value) => {
    vi.stubEnv("ENG_AGENT_MIN_CONFIDENCE", value);
    expect(runtimePolicy().minimumConfidence).toBe(Number(value));
  });

  it.each(["", " ", "NaN", "Infinity", "-Infinity", "-0.1", "1.1", "high"])
    ("rejects invalid thresholds: %s", (value) => {
      vi.stubEnv("ENG_AGENT_MIN_CONFIDENCE", value);
      expect(() => runtimePolicy()).toThrow("ENG_AGENT_MIN_CONFIDENCE");
    });
});

describe("runtimePolicy repository overrides", () => {
  it("isolates repository policies, inherits omitted settings, and preserves global defaults", () => {
    vi.stubEnv("ENG_AGENT_REPOSITORIES", "example/frontend,example/backend");
    vi.stubEnv("ENG_AGENT_BASE_BRANCHES", "main");
    vi.stubEnv("ENG_AGENT_REQUIRED_CHECKS", "lint,test");
    vi.stubEnv("ENG_AGENT_ALLOWED_NEUTRAL_CHECKS", "optional");
    vi.stubEnv("ENG_AGENT_ALLOWED_SKIPPED_CHECKS", "docs");
    vi.stubEnv("ENG_AGENT_MIN_CONFIDENCE", "0.9");
    vi.stubEnv("ENG_AGENT_REPOSITORY_POLICIES", JSON.stringify({
      "Example/Frontend": {
        baseBranches: [" release "],
        requiredSuccessChecks: ["Lint, Typecheck & Test"],
        allowedNeutralChecks: [],
        allowedSkippedChecks: [" preview "],
        minimumConfidence: 0.95,
      },
      "example/backend": { requiredSuccessChecks: ["server tests"], minimumConfidence: 1 },
    }));

    const globals = runtimePolicy();
    expect(globals).toEqual({
      repositories: ["example/frontend", "example/backend"],
      baseBranches: ["main"], requiredSuccessChecks: ["lint", "test"],
      allowedNeutralChecks: ["optional"], allowedSkippedChecks: ["docs"], minimumConfidence: 0.9,
    });
    expect(runtimePolicy("example/frontend")).toEqual({
      ...globals, baseBranches: ["release"], requiredSuccessChecks: ["Lint, Typecheck & Test"],
      allowedNeutralChecks: [], allowedSkippedChecks: ["preview"], minimumConfidence: 0.95,
    });
    expect(runtimePolicy("example/backend")).toEqual({
      ...globals, requiredSuccessChecks: ["server tests"], minimumConfidence: 1,
    });
  });

  it("does not activate or apply overrides to an unallowlisted repository", () => {
    vi.stubEnv("ENG_AGENT_REPOSITORIES", "example/frontend");
    vi.stubEnv("ENG_AGENT_REPOSITORY_POLICIES", JSON.stringify({
      "example/backend": { minimumConfidence: 0 },
      "example/frontend": { minimumConfidence: 0 },
    }));
    expect(runtimePolicy("example/backend")).toEqual(runtimePolicy());
    expect(runtimePolicy("Example/Frontend")).toEqual(runtimePolicy());
    expect(runtimePolicy("example/backend").repositories).not.toContain("example/backend");
    vi.stubEnv("ENG_AGENT_REPOSITORIES", undefined);
    expect(runtimePolicy("example/frontend").repositories).toEqual([]);
    expect(runtimePolicy("example/frontend")).toEqual(runtimePolicy());
  });

  it.each([undefined, "", "  ", "{}"])('allows absent or empty overrides: %s', (value) => {
    vi.stubEnv("ENG_AGENT_REPOSITORY_POLICIES", value);
    expect(runtimePolicy("example/frontend")).toEqual(runtimePolicy());
  });

  it.each([
    "{", "null", "[]", '"policy"',
    '{"frontend":{}}', '{"example/front end":{}}', '{"example/frontend/extra":{}}',
    '{"example/frontend":null}', '{"example/frontend":[]}',
    '{"example/frontend":{"enabled":true}}',
    '{"example/frontend":{"repositories":["example/frontend"]}}',
    '{"example/frontend":{},"Example/Frontend":{}}',
    ...["baseBranches", "requiredSuccessChecks", "allowedNeutralChecks", "allowedSkippedChecks"]
      .flatMap((key) => [null, "lint", [""], [" "], [42], [null]].map(
        (value) => JSON.stringify({ "example/frontend": { [key]: value } }),
      )),
    ...[null, "0.95", -0.1, 1.1, true].map(
      (value) => JSON.stringify({ "example/frontend": { minimumConfidence: value } }),
    ),
    '{"example/frontend":{"minimumConfidence":1e999}}',
  ])("rejects invalid overrides even without a repository selection: %s", (value) => {
    vi.stubEnv("ENG_AGENT_REPOSITORY_POLICIES", value);
    expect(() => runtimePolicy()).toThrow("ENG_AGENT_REPOSITORY_POLICIES");
  });
});
