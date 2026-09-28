import { defineTool } from "eve/tools";
import { never } from "eve/tools/approval";
import { z } from "zod/v4";
import { evaluateCheckGate } from "../lib/check-gate";
import { REVIEW_SUMMARY_MAX_LENGTH, runtimePolicy } from "../lib/config";
import { evaluateApprovalDecision } from "../lib/decision";
import { authenticatedGitHubRequester, loadPullRequestSnapshot } from "../lib/github-api";
import { calculateFinalRisk, calculatePolicyAssessment } from "../lib/risk-policy";
import { publishRiskAssessment } from "../lib/review-publisher";
import { githubSessionTarget } from "../lib/session";
import { notifySlackReviewReady } from "../lib/slack-review-notifier";

const riskLevelSchema = z.enum(["very_low", "low", "medium", "high"]);

const dimensionsSchema = z.object({
  changeComplexity: riskLevelSchema,
  blastRadius: riskLevelSchema,
  dataSecurity: riskLevelSchema,
  operationalRecovery: riskLevelSchema,
  verification: riskLevelSchema,
});

const findingSchema = z.object({
  severity: z.enum(["low", "medium", "high"]),
  title: z.string().min(1).max(160),
  body: z.string().min(1).max(2_000),
  path: z.string().min(1).max(500).optional(),
  line: z.number().int().positive().optional(),
});

export default defineTool({
  description:
    "Submit evidence-backed PR risk dimensions for the reviewed head SHA. Re-checks GitHub, computes risk, and publishes APPROVE, REQUEST CHANGES, or NEEDS HUMAN through deterministic gates.",
  inputSchema: z.object({
    headSha: z.string().regex(/^[a-f0-9]{40}$/u),
    dimensions: dimensionsSchema,
    confidence: z.number().min(0).max(1),
    summary: z
      .string()
      .trim()
      .min(1)
      .max(
        REVIEW_SUMMARY_MAX_LENGTH,
        `Write one complete summary sentence of at most ${REVIEW_SUMMARY_MAX_LENGTH} characters; do not rely on truncation.`,
      ),
    evidence: z
      .array(
        z.object({
          path: z.string().min(1).max(500),
          explanation: z.string().min(1).max(1_000),
        }),
      )
      .max(10),
    findings: z.array(findingSchema).max(20),
  }),
  approval: never(),
  async execute(input, ctx) {
    const target = githubSessionTarget(ctx);
    const policy = runtimePolicy(target.repository);
    if (!policy.repositories.includes(target.repository)) {
      return { status: "blocked", reason: `Repository ${target.repository} is not allowlisted.` };
    }

    const request = authenticatedGitHubRequester();
    const snapshot = await loadPullRequestSnapshot(
      request,
      target.owner,
      target.repo,
      target.pullNumber,
    );
    if (snapshot.pullRequest.head.sha !== input.headSha) {
      return {
        status: "stale",
        reason: "The PR head moved during review. A fresh turn must assess the new commit.",
        reviewedSha: input.headSha,
        currentSha: snapshot.pullRequest.head.sha,
      };
    }

    const checkGate = evaluateCheckGate(snapshot.checkRuns, snapshot.statuses, policy);
    if (!checkGate.ready) {
      return {
        status: "checks_not_ready",
        reason: "The exact reviewed commit no longer has a fully green configured check gate.",
        checkGate,
      };
    }

    const policyAssessment = calculatePolicyAssessment(snapshot.files);
    const finalRisk = calculateFinalRisk({
      dimensions: input.dimensions,
      confidence: input.confidence,
      findings: input.findings,
      policy: policyAssessment,
      minimumConfidence: policy.minimumConfidence,
    });
    const decision = evaluateApprovalDecision({
      snapshot,
      checkGate,
      finalRisk,
      findings: input.findings,
      repositories: policy.repositories,
      baseBranches: policy.baseBranches,
      minimumConfidence: policy.minimumConfidence,
      confidence: input.confidence,
      policy: policyAssessment,
    });
    const published = await publishRiskAssessment({
      request,
      snapshot,
      finalRisk,
      policy: policyAssessment,
      dimensions: input.dimensions,
      confidence: input.confidence,
      summary: input.summary,
      evidence: input.evidence,
      findings: input.findings,
      decision,
    });
    const slackNotification = await notifySlackReviewReady({
      snapshot,
      finalRisk,
      decision,
      summary: input.summary,
      confidence: input.confidence,
    });

    return {
      status: "published",
      headSha: input.headSha,
      risk: finalRisk,
      disposition: decision.disposition,
      automaticApproval: decision.disposition === "approve",
      approvalBlockers: decision.blockers,
      checkGate,
      published,
      slackNotification,
    };
  },
});
