---
name: pr-risk-review
description: Review a GitHub pull request, assign its final 0-100 engineering risk score, and approve only a code-eligible low-risk result.
---

# PR risk review

Use this procedure for every automated PR-risk turn and whenever a human asks for a PR risk assessment.

## Required sequence

1. Call `get_pr_risk_context`. Its deterministic risk floor, human-only requirements, reviewability, and gate data are authoritative.
2. Run `git rev-parse HEAD` in the sandbox and require it to equal the head SHA from the risk context. If the checkout is missing or mismatched, do not approve.
3. Read the changed files and relevant surrounding code in the sandbox checkout.
4. Judge risk by likely consequence, blast radius, and recoverability—not by line count or sensitive-sounding nouns alone. Reading sensitive data in an internal report is not equivalent to mutating it.
5. Apply the baseline calibration below, then score the six dimensions using `references/scoring.md`.
6. Report concrete findings. A medium finding must force at least medium risk; a high finding must force high risk.
7. Call `submit_pr_risk_decision` with the reviewed head SHA. The tool recomputes the final score, re-reads GitHub, and deterministically chooses APPROVE, REQUEST CHANGES, or NEEDS HUMAN.

Do not lower a score to make a PR approvable. Do not treat green CI as proof of low risk. Do not treat a docs-only title as proof that the diff is docs-only.

## Baseline calibration

Low risk means a defect is contained and readily repairable:

- docs, changelogs, generated docs, tests, fixtures, copy, styles, layout, and visual polish;
- isolated frontend presentation or navigation changes with no permission, persistence, or cross-session state change;
- internal/admin reports that are read-only, bounded, fail-soft, and cleanly implemented—even when they read billing or operational data;
- narrow observability or developer-tooling changes with no production control-plane effect.

Medium risk means meaningful behavior can regress but rollback or repair is straightforward:

- end-user feature logic, client/server state coordination, caches, search behavior, or API read semantics;
- external-service reads in user-facing paths, dependency upgrades, background-job control flow, and reversible performance or reliability changes;
- internal tools that write data or trigger actions, or reports whose output drives automated/customer-facing decisions;
- a plausible defect with real user or operational impact but no likely security breach, durable corruption, or hard-to-reverse effect.

High risk means failure can cross a trust boundary, mutate durable state broadly, or be difficult to recover:

- authentication, authorization, tenant isolation, secrets, encryption, privacy, or permission enforcement;
- billing, entitlement, subscription, identity, or customer-communication mutations—not merely reading those records;
- schemas, migrations, backfills, destructive operations, production workflow/infra changes, or broad durable-execution changes;
- credible data loss, cross-tenant exposure, financial corruption, duplicated side effects, or a rollback that cannot restore prior state.

Diff size does not set risk. Large generated or repetitive diffs can remain low risk; an oversized reviewable diff separately requires human review. Conversely, a tiny permission or destructive-data change can be high risk and is always human-only.

Confidence is an approval gate, not part of the risk band. A low-risk review may still require a human because confidence is low, checks are incomplete, or review threads remain unresolved.

A medium or high finding means REQUEST CHANGES. A clean change that is medium/high risk, human-only, insufficiently reviewable, or otherwise approval-ineligible means NEEDS HUMAN. Never describe NEEDS HUMAN as evidence that the code is defective.

## GitHub writing contract

- Summary: one complete plain sentence, at most 180 characters. State the consequence and recoverability. It is rendered in full and is never truncated.
- Findings: at most five, ordered high to low. Use one short title and one actionable sentence each. Do not repeat evidence in the summary.
- Evidence: at most six load-bearing files. Do not inventory every changed file.
- Do not narrate sandbox/tool mechanics in the visible summary. Reflect incomplete inspection in confidence and verification-gap scoring.
- Treat a limited, display-only inaccuracy or missing edge-case test as low severity. Use medium/high only when the consequence meets the definitions above.
