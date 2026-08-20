import type { PullRequestSnapshot } from "../agent/lib/types";

export function snapshot(overrides: Partial<PullRequestSnapshot> = {}): PullRequestSnapshot {
  const value: PullRequestSnapshot = {
    owner: "acme",
    repo: "example-app",
    pullRequest: {
      number: 42,
      title: "Small safe change",
      body: null,
      state: "open",
      draft: false,
      mergeable: true,
      additions: 3,
      deletions: 1,
      changed_files: 1,
      user: { login: "engineer", type: "User" },
      base: {
        ref: "main",
        sha: "b".repeat(40),
        repo: { full_name: "acme/example-app" },
      },
      head: {
        ref: "feature",
        sha: "a".repeat(40),
        repo: { full_name: "acme/example-app" },
      },
    },
    files: [
      {
        filename: "docs/example.md",
        status: "modified",
        additions: 3,
        deletions: 1,
        changes: 4,
      },
    ],
    checkRuns: [
      { id: 1, name: "lint", status: "completed", conclusion: "success" },
      { id: 2, name: "Vercel", status: "completed", conclusion: "success" },
    ],
    statuses: [],
    reviews: [],
    reviewThreads: { known: true, unresolved: 0 },
  };
  return { ...value, ...overrides };
}
