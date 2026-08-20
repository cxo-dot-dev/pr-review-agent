import { RISK_CHECK_NAME } from "./config";
import type { CheckRun, CommitStatus } from "./types";

export interface CheckGatePolicy {
  requiredSuccessChecks: readonly string[];
  allowedNeutralChecks: readonly string[];
  allowedSkippedChecks: readonly string[];
}

export interface CheckGateResult {
  ready: boolean;
  missing: readonly string[];
  pending: readonly string[];
  blocking: readonly string[];
  accepted: readonly string[];
}

const BLOCKING_CONCLUSIONS = new Set([
  "action_required",
  "cancelled",
  "failure",
  "stale",
  "startup_failure",
  "timed_out",
]);

export function evaluateCheckGate(
  runs: readonly CheckRun[],
  statuses: readonly CommitStatus[],
  policy: CheckGatePolicy,
): CheckGateResult {
  const latestRuns = latestByName(runs.filter((run) => run.name !== RISK_CHECK_NAME));
  const latestStatuses = latestByName(
    statuses.map((status) => ({ ...status, name: status.context })),
  );
  const required = new Set(policy.requiredSuccessChecks);
  const observedNames = new Set([
    ...latestRuns.map((run) => run.name),
    ...latestStatuses.map((status) => status.name),
  ]);
  const missing = [...required].filter((name) => !observedNames.has(name));
  const pending: string[] = [];
  const blocking: string[] = [];
  const accepted: string[] = [];

  for (const run of latestRuns) {
    if (run.status !== "completed" || run.conclusion === null) {
      pending.push(run.name);
      continue;
    }

    if (run.conclusion === "success") {
      accepted.push(run.name);
      continue;
    }

    if (run.conclusion === "neutral" && policy.allowedNeutralChecks.includes(run.name)) {
      accepted.push(`${run.name} (neutral)`);
      continue;
    }

    if (run.conclusion === "skipped" && policy.allowedSkippedChecks.includes(run.name)) {
      accepted.push(`${run.name} (skipped)`);
      continue;
    }

    const suffix = BLOCKING_CONCLUSIONS.has(run.conclusion) ? run.conclusion : `unapproved ${run.conclusion}`;
    blocking.push(`${run.name} (${suffix})`);
  }

  for (const status of latestStatuses) {
    if (status.state === "pending") {
      pending.push(status.name);
    } else if (status.state === "success") {
      accepted.push(status.name);
    } else {
      blocking.push(`${status.name} (${status.state})`);
    }
  }

  for (const name of required) {
    const run = latestRuns.find((item) => item.name === name);
    const status = latestStatuses.find((item) => item.name === name);
    const succeeded = run?.status === "completed" && run.conclusion === "success";
    const statusSucceeded = status?.state === "success";
    if (!succeeded && !statusSucceeded && !missing.includes(name)) {
      blocking.push(`${name} (required success)`);
    }
  }

  return {
    ready: missing.length === 0 && pending.length === 0 && blocking.length === 0,
    missing: uniqueSorted(missing),
    pending: uniqueSorted(pending),
    blocking: uniqueSorted(blocking),
    accepted: uniqueSorted(accepted),
  };
}

function latestByName<T extends { name: string; id: number }>(items: readonly T[]): T[] {
  const result = new Map<string, T>();
  for (const item of items) {
    const current = result.get(item.name);
    if (!current || item.id > current.id) result.set(item.name, item);
  }
  return [...result.values()];
}

function uniqueSorted(items: readonly string[]): string[] {
  return [...new Set(items)].sort((a, b) => a.localeCompare(b));
}
