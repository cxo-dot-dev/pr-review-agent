# PR risk policy

Policy version `2026-08-03.1` produces a score from 0 to 100. Risk measures likely consequence, blast radius, and recoverability. It is separate from reviewability and whether the bot may approve.

## Model dimensions

| Dimension | Weight |
| --- | ---: |
| Change surface | 20 |
| Blast radius | 20 |
| Reversibility | 15 |
| Data and security | 20 |
| Operational risk | 15 |
| Verification gap | 10 |

The final score is the maximum of the model total and every applicable deterministic floor. Changed-line count is supporting evidence, not a proxy for consequence.

## Baseline bands

- **Low (0–24):** documentation, tests, copy, styles, isolated presentation changes, clean read-only internal reports, and narrow developer tooling. Failures are contained and easy to repair.
- **Medium (25–64):** reversible product behavior, APIs, caches, dependencies, background jobs, user-facing external reads, and internal tools with writes. Failures have real impact but are normally straightforward to stop or revert.
- **High (65–100):** trust boundaries, billing/payment/identity mutations, schemas, migrations, backfills, destructive operations, infrastructure, or broad durable execution. Failures can expose data, corrupt durable state, duplicate side effects, or resist rollback.

Reading sensitive data is not the same as mutating it. A bounded read-only finance report can be low risk; a payment cancellation endpoint is high risk.

## Deterministic floors

- 70: database migrations/schema, deployment workflows/infrastructure, and recognizable production billing/payment/identity mutation paths.
- 45: authentication, authorization, and sensitive enforcement surfaces.
- 35: dependencies/lockfiles, server/API/background-job behavior, or runtime configuration.
- 25: any medium finding.
- 65: any high finding.

Changed-file and line counts never set the band. They can make autonomous review ineligible without describing the change as risky.

## Human-only surfaces

The baseline requires a human decision for authentication/authorization, permissions, tenant boundaries, secrets, encryption, privacy, billing/payment/identity mutations, migrations, backfills, destructive operations, infrastructure, deployment workflows, and the agent's own approval policy. These requirements cannot be overridden by model scores or confidence.

The included [`personalize-pr-review-agent` skill](../.agents/skills/personalize-pr-review-agent/SKILL.md) helps map these generic rules to your stack's actual paths and priorities.

## Reviewability and automatic approval

More than 75 non-constrained files or 10,000 non-constrained changed lines requires human review but does not raise risk. Documentation, tests, fixtures, styles, translations, and similar constrained surfaces do not consume that budget.

Automatic approval requires every gate to pass: low final risk, confidence at least 0.90, unchanged exact SHA, allowlisted repository/base branch, open non-draft non-conflicted PR, no fork, all configured required checks successful, no unapproved terminal check conclusions, readable and resolved review threads, no active changes request, no medium/high finding, no human-only path, and sufficient reviewability.

The final disposition is:

- `APPROVE` when every gate passes;
- `REQUEST CHANGES` when a medium or high finding must be fixed; or
- `NEEDS HUMAN` when the change may be clean but policy or repository state requires judgment.

Checks and reviews include the exact head SHA and policy version. Duplicate webhook deliveries reuse the existing assessment. New commits or non-green check activity trigger best-effort dismissal of the agent's earlier approval. The agent never merges.
