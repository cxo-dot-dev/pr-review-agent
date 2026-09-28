import type {
  PullRequestFile,
  RiskBand,
  RiskDimensions,
  RiskFinding,
  RiskLevel,
} from "./types";

export interface PolicyFlag {
  code: string;
  reason: string;
  levelFloor: RiskLevel;
  paths: readonly string[];
}

export interface HumanReviewRequirement {
  code: string;
  reason: string;
  paths: readonly string[];
}

export interface ReviewabilityAssessment {
  sufficient: boolean;
  reasons: readonly string[];
  reviewableChanges: number;
  reviewableFiles: number;
}

export interface PolicyAssessment {
  riskFloor: RiskLevel;
  riskFlags: readonly PolicyFlag[];
  humanReviewRequirements: readonly HumanReviewRequirement[];
  reviewability: ReviewabilityAssessment;
  totalChanges: number;
  changedFiles: number;
}

export interface FinalRiskInput {
  dimensions: RiskDimensions;
  confidence: number;
  findings: readonly RiskFinding[];
  policy: PolicyAssessment;
  minimumConfidence: number;
}

export interface FinalRisk {
  band: RiskLevel;
  dimensionPeak: RiskLevel;
  policyFloor: RiskLevel;
  confidenceBlocksApproval: boolean;
  promotedForFinding: RiskBand | null;
}

const HIGH_PATH_RULES: readonly [string, RegExp][] = [
  ["database migration", /(^|\/)(migrations?|prisma\/migrations)(\/|\.|$)/iu],
  ["deployment workflow", /^\.github\/workflows\//u],
  ["infrastructure", /(^|\/)(terraform|infrastructure|infra)(\/|\.|$)/iu],
  ["database schema", /(^|\/)(schema\.prisma|database-schema|db-schema)(\/|$)/iu],
  [
    "production billing, payment, or identity mutation",
    /(^|\/)(?:api|routes?|handlers?|webhooks?|commands?|actions?)(?:\/|\.)[^/]*(?:billing|payments?|subscriptions?|checkout|identity|accounts?)[^/]*(?:\/|\.|$)|(^|\/)(?:billing|payments?|subscriptions?|identity)[^/]*(?:webhooks?|checkout|cancel|delete|mutation|command)[^/]*(?:\/|\.|$)/iu,
  ],
];

const MEDIUM_PATH_RULES: readonly [string, RegExp][] = [
  [
    "authentication or authorization boundary",
    /(^|\/)[^/]*(?:auth|authentication|authorization|permissions?|access|tenant|rbac|iam|middleware|proxy)[^/]*(?:\/|\.|$)/iu,
  ],
  [
    "sensitive enforcement surface",
    /(^|\/)(authorization|permissions?|access-control|tenant-isolation|encryption|crypto|secrets?)(\/|\.|$)/iu,
  ],
  ["dependency graph", /(^|\/)(package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb)$/u],
  ["server or API behavior", /(^|\/)(api|server|actions|jobs?|workers?|schedulers?|queues?)(\/|\.|$)/iu],
  ["runtime configuration", /(^|\/)(vercel\.json|next\.config\.[^/]+|middleware\.[^/]+|instrumentation\.[^/]+)$/iu],
];

const HUMAN_ONLY_PATH_RULES: readonly [string, RegExp][] = [
  ...HIGH_PATH_RULES,
  [
    "authentication, authorization, or tenant boundary",
    /(^|\/)[^/]*(?:auth|authentication|authorization|permission|access|tenant|rbac|iam|middleware|proxy)[^/]*(?:\/|\.|$)/iu,
  ],
  [
    "billing, payment, entitlement, or identity mutation",
    /(^|\/)(?:api|routes?|handlers?|webhooks?|commands?|actions?|jobs?|workers?)(?:\/|\.)[^/]*(?:billing|payments?|subscriptions?|entitlements?|identity|accounts?)[^/]*(?:\/|\.|$)|(^|\/)(?:billing|payments?|subscriptions?|entitlements?|identity)[^/]*(?:webhooks?|checkout|cancel|delete|mutation|command|sync|update)[^/]*(?:\/|\.|$)/iu,
  ],
  ["secrets, encryption, or privacy boundary", /(^|\/)(secrets?|encryption|crypto|privacy)(\/|\.|$)/iu],
  ["backfill or destructive operation", /(^|\/)(?:[^/]*backfill[^/]*|destructive|data-fix|data-migration)(\/|\.|$)/iu],
  ["approval policy or governance", /(^|\/)(?:CODEOWNERS|agent\/(?:instructions\.md|lib\/(?:risk-policy|decision|check-gate|review-publisher)\.ts|skills\/pr-risk-review(?:\/.*)?|tools\/(?:get_pr_risk_context|submit_pr_risk_decision)\.ts))$/iu],
];

const MAX_REVIEWABLE_CHANGES = 10_000;
const MAX_REVIEWABLE_FILES = 75;

export function calculatePolicyAssessment(files: readonly PullRequestFile[]): PolicyAssessment {
  const riskFlags: PolicyFlag[] = [];
  const humanReviewRequirements: HumanReviewRequirement[] = [];
  const totalChanges = files.reduce((sum, file) => sum + file.changes, 0);

  const runtimePaths = [...new Set(files.flatMap(filePaths))].filter(
    (path) => !isDocumentationOrTest(path),
  );
  const reviewableFiles = files.filter((file) => filePaths(file).some((path) => !isConstrainedSurface(path)));
  const reviewableChanges = reviewableFiles.reduce((sum, file) => sum + file.changes, 0);

  for (const [reason, pattern] of HIGH_PATH_RULES) {
    const paths = runtimePaths.filter((path) => pattern.test(path));
    if (paths.length > 0) riskFlags.push({ code: slug(reason), reason, levelFloor: "high", paths });
  }

  for (const [reason, pattern] of MEDIUM_PATH_RULES) {
    const paths = runtimePaths.filter((path) => pattern.test(path));
    if (paths.length > 0) {
      const levelFloor = "medium";
      riskFlags.push({ code: slug(reason), reason, levelFloor, paths });
    }
  }

  for (const [reason, pattern] of HUMAN_ONLY_PATH_RULES) {
    const paths = runtimePaths.filter((path) => pattern.test(path));
    if (paths.length > 0) {
      humanReviewRequirements.push({ code: slug(reason), reason, paths });
    }
  }

  const reviewabilityReasons: string[] = [];
  if (reviewableFiles.length > MAX_REVIEWABLE_FILES) {
    reviewabilityReasons.push(
      `${reviewableFiles.length} reviewable files exceeds the ${MAX_REVIEWABLE_FILES}-file autonomous review limit`,
    );
  }
  if (reviewableChanges > MAX_REVIEWABLE_CHANGES) {
    reviewabilityReasons.push(
      `${reviewableChanges} reviewable changes exceeds the ${MAX_REVIEWABLE_CHANGES}-change autonomous review limit`,
    );
  }

  const riskFloor = maxRiskLevel([
    baseFloor(files),
    ...riskFlags.map((flag) => flag.levelFloor),
  ]);
  return {
    riskFloor,
    riskFlags,
    humanReviewRequirements,
    reviewability: {
      sufficient: reviewabilityReasons.length === 0,
      reasons: reviewabilityReasons,
      reviewableChanges,
      reviewableFiles: reviewableFiles.length,
    },
    totalChanges,
    changedFiles: files.length,
  };
}

export function calculateFinalRisk(input: FinalRiskInput): FinalRisk {
  const dimensionPeak = maxRiskLevel(Object.values(input.dimensions));
  const highestFinding = highestFindingBand(input.findings);
  const findingFloor: RiskLevel = highestFinding ?? "very_low";

  return {
    band: maxRiskLevel([dimensionPeak, input.policy.riskFloor, findingFloor]),
    dimensionPeak,
    policyFloor: input.policy.riskFloor,
    confidenceBlocksApproval: input.confidence < input.minimumConfidence,
    promotedForFinding: highestFinding,
  };
}

export function maxRiskLevel(levels: readonly RiskLevel[]): RiskLevel {
  return levels.reduce(
    (highest, level) => RISK_LEVEL_WEIGHT[level] > RISK_LEVEL_WEIGHT[highest] ? level : highest,
    "very_low",
  );
}

const RISK_LEVEL_WEIGHT: Readonly<Record<RiskLevel, number>> = {
  very_low: 0,
  low: 1,
  medium: 2,
  high: 3,
};

function baseFloor(files: readonly PullRequestFile[]): RiskLevel {
  if (files.length === 0) return "medium";
  if (files.every((file) => filePaths(file).every(isDocumentation))) return "very_low";
  if (files.every((file) => filePaths(file).every(isConstrainedSurface))) return "very_low";
  return "low";
}

function filePaths(file: PullRequestFile): string[] {
  return file.previous_filename ? [file.filename, file.previous_filename] : [file.filename];
}

function isDocumentation(path: string): boolean {
  return /(^|\/)(docs?|README|CHANGELOG)(\/|\.|$)/iu.test(path);
}

function isDocumentationOrTest(path: string): boolean {
  return (
    isDocumentation(path) ||
    /(^|\/)(__tests__|tests?|fixtures?|snapshots?)(\/|\.|$)/iu.test(path) ||
    /\.(?:test|spec)\.[^/]+$/iu.test(path)
  );
}

function isConstrainedSurface(path: string): boolean {
  return (
    isDocumentationOrTest(path) ||
    /\.(md|mdx|css|scss|sass|less|txt|svg|snap)$/iu.test(path) ||
    /(^|\/)(locales?|translations?|copy)(\/|\.|$)/iu.test(path)
  );
}

function highestFindingBand(findings: readonly RiskFinding[]): RiskBand | null {
  if (findings.some((finding) => finding.severity === "high")) return "high";
  if (findings.some((finding) => finding.severity === "medium")) return "medium";
  if (findings.some((finding) => finding.severity === "low")) return "low";
  return null;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "");
}
