# PR risk policy

Policy version `2026-09-09.2` rates five areas as **very low**, **low**, **medium**, or **high**. Risk measures likely consequence, blast radius, and recoverability. It remains separate from reviewability and whether the bot may approve.

## Risk areas

| Area | What to assess |
| --- | --- |
| Change complexity | Behavioral breadth, coupling, novelty, and affected components |
| Blast radius | Users, tenants, workflows, and systems that can be affected |
| Data and security | Trust boundaries, privacy, secrets, permissions, and durable-data consequences |
| Operational and recovery | Deployments, migrations, queues, side effects, availability, rollback, and repair |
| Verification | Important behavior not convincingly exercised by tests or other evidence |

## Aggregation

The overall level is the highest of:

1. the five area ratings;
2. the deterministic path-policy floor; and
3. the highest substantive finding severity.

This is a maximum-consequence model, not an average. One high data/security or recovery risk remains high even if the other areas are very low. Breadth still appears in the profile and evidence; it cannot dilute a serious risk.

## Levels

- **Very low:** Minimal behavioral consequence and immediate recovery, such as clean documentation or constrained static changes.
- **Low:** Contained consequence and straightforward rollback or repair, such as isolated presentation changes or bounded read-only tooling.
- **Medium:** Meaningful product or operational behavior can regress, but recovery is understood and normally straightforward.
- **High:** Failure can cross a trust boundary, mutate durable state broadly, expose data, duplicate side effects, or be difficult to recover.

Reading sensitive data is not the same as mutating it. A bounded read-only finance report can be low; a payment cancellation endpoint is high.

## Deterministic floors

- **High:** database migrations/schema, deployment workflows/infrastructure, and recognizable production billing/payment/identity mutations.
- **Medium:** authentication/authorization, sensitive enforcement surfaces, dependencies/lockfiles, server/API/background-job behavior, and runtime configuration.
- **Medium or high:** any finding at the corresponding severity.

Changed-file and line counts never set the level. They can make autonomous review ineligible without describing the change as risky.

## Human-only surfaces

The baseline requires a human decision for authentication/authorization, permissions, tenant boundaries, secrets, encryption, privacy, billing/payment/identity mutations, migrations, backfills, destructive operations, infrastructure, deployment workflows, and the agent's own approval policy. These requirements cannot be overridden by ratings or confidence.

The included [`personalize-pr-review-agent` skill](../.agents/skills/personalize-pr-review-agent/SKILL.md) helps map these generic rules to your stack's actual paths and priorities.

Renamed files are assessed using both their original and destination paths. Moving sensitive runtime code into a documentation or test directory does not remove its risk floor, human-review requirement, or reviewability cost.

## Reviewability and automatic approval

More than 75 non-constrained files or 10,000 non-constrained changed lines requires human review but does not raise risk. Documentation, tests, fixtures, styles, translations, and similar constrained surfaces do not consume that budget.

Automatic approval requires every gate to pass: very-low or low overall risk, confidence at least 0.90, unchanged exact SHA, allowlisted repository/base branch, open non-draft non-conflicted PR, no fork, all configured required checks successful, no unapproved terminal check conclusions, readable and resolved review threads, no active changes request, no medium/high finding, no human-only path, and sufficient reviewability.

The final disposition is:

- `APPROVE` when every gate passes;
- `REQUEST CHANGES` when a medium or high finding must be fixed; or
- `NEEDS HUMAN` when the change may be clean but policy or repository state requires judgment.

Checks and reviews include the exact head SHA and policy version. Duplicate webhook deliveries reuse the existing assessment. New commits or non-green check activity trigger best-effort dismissal of the agent's earlier approval. The agent never merges.
