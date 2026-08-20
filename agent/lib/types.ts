export type RiskLevel = "very_low" | "low" | "medium" | "high";
export type RiskBand = Exclude<RiskLevel, "very_low">;
export type FindingSeverity = RiskBand;

export interface RiskDimensions {
  changeComplexity: RiskLevel;
  blastRadius: RiskLevel;
  dataSecurity: RiskLevel;
  operationalRecovery: RiskLevel;
  verification: RiskLevel;
}

export interface RiskFinding {
  severity: FindingSeverity;
  title: string;
  body: string;
  path?: string | undefined;
  line?: number | undefined;
}

export interface RiskEvidence {
  path: string;
  explanation: string;
}

export interface PullRequestFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
}

export interface PullRequestDetails {
  number: number;
  title: string;
  body: string | null;
  state: string;
  draft: boolean;
  mergeable: boolean | null;
  additions: number;
  deletions: number;
  changed_files: number;
  user: { login: string; type: string };
  base: { ref: string; sha: string; repo: { full_name: string } };
  head: { ref: string; sha: string; repo: { full_name: string } | null };
}

export interface CheckRun {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  app?: { slug?: string | null } | null;
  completed_at?: string | null;
  external_id?: string | null;
}

export interface CommitStatus {
  id: number;
  context: string;
  state: string;
  updated_at?: string;
}

export interface PullRequestReview {
  id: number;
  state: string;
  body: string | null;
  commit_id: string | null;
  submitted_at: string | null;
  user: { login: string; type: string } | null;
}

export interface ReviewThreadSummary {
  known: boolean;
  unresolved: number;
}

export interface PullRequestSnapshot {
  owner: string;
  repo: string;
  pullRequest: PullRequestDetails;
  files: readonly PullRequestFile[];
  checkRuns: readonly CheckRun[];
  statuses: readonly CommitStatus[];
  reviews: readonly PullRequestReview[];
  reviewThreads: ReviewThreadSummary;
}

export type GitHubMethod = "DELETE" | "GET" | "PATCH" | "POST" | "PUT";
export type GitHubRequester = <T>(method: GitHubMethod, path: string, body?: object) => Promise<T>;
