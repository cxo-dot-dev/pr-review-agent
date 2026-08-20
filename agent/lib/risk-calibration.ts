import { POLICY_VERSION } from "./config";
import type { PullRequestFile } from "./types";

export const RISK_CALIBRATION = {
  version: POLICY_VERSION,
  directive:
    "Reassess the current diff using this calibration. It supersedes prior-session ratings; never preserve an old rating merely because the code is unchanged when the policy changed.",
  principle:
    "Risk measures consequence, blast radius, and recoverability. Diff reviewability, human-only paths, confidence, and approval eligibility are separate deterministic gates.",
  low: [
    "docs, changelogs, generated docs, tests, copy, styles, layout, and visual polish",
    "isolated frontend presentation or navigation without permission, persistence, or cross-session state changes",
    "clean internal/admin reports that are read-only, bounded, and fail-soft, even when they read billing or operational data",
  ],
  medium: [
    "reversible end-user behavior, client/server state coordination, APIs, caches, dependencies, and background-job control flow",
    "internal tools that write data or trigger actions, and reports that drive automated or customer-facing decisions",
  ],
  high: [
    "authentication, authorization, tenant isolation, secrets, encryption, privacy, or permission enforcement",
    "billing, entitlement, subscription, identity, or customer-communication mutations",
    "schemas, migrations, backfills, destructive operations, workflow or infrastructure changes, and difficult recovery",
  ],
  internalReadOnlyReportProfile: {
    changeComplexity: "low",
    blastRadius: "very_low",
    dataSecurity: "low",
    operationalRecovery: "low",
    verification: "low",
  },
  notes: [
    "Reading sensitive business data is not equivalent to mutating it.",
    "A bounded fail-soft external read is normally very low or low for operational/recovery risk.",
    "Diff size never sets the risk band; oversized reviewable diffs separately require a human.",
    "Rate above an archetype profile only for a concrete consequence or finding, and explain that evidence.",
  ],
} as const;

export function detectRiskArchetypes(files: readonly PullRequestFile[]): readonly string[] {
  const paths = files.map((file) => file.filename);
  const archetypes: string[] = [];
  if (paths.length > 0 && paths.every(isDocumentationPath)) archetypes.push("documentation-only");
  if (
    paths.some((path) =>
      /(^|\/)(?:internal|admin|reports?|analytics|dashboards?)(\/|\.|-|_)/iu.test(
        path,
      ),
    )
  ) {
    archetypes.push("internal-report-candidate");
  }
  return archetypes;
}

function isDocumentationPath(path: string): boolean {
  return /(^|\/)(docs?|README|CHANGELOG)(\/|\.|$)/iu.test(path);
}
