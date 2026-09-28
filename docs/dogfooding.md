# Dogfood on one repository

Start with one repository and expand after a live canary passes. This is a self-hosted Eve service on Vercel: GitHub App events start a sandbox review, deterministic policy chooses the disposition, and the service publishes a GitHub check and review. Installation does not require adding an Action to the target repository.

## Prepare the pilot

1. Follow the [deployment instructions](../README.md#deploy-to-vercel). Confirm access to Vercel Connect, Sandbox, and AI Gateway, including the model configured in `agent/agent.ts`.
2. Install the GitHub App on the selected pilot repository only. Follow the [App permissions](github-app.md), including **Commit statuses: read** so the service can inspect status-based CI providers. Keep the installation scope and `ENG_AGENT_REPOSITORIES` allowlist aligned.
3. Inventory the repository's base branch, actual check-run names and commit-status contexts, conditional jobs, and sensitive paths. Use the [personalization skill](../.agents/skills/personalize-pr-review-agent/SKILL.md) to assess whether the baseline policy covers the stack.
4. Configure the allowlist, base branch, check names, connector UID, and bot slug in the deployment environment. Leave Slack disabled for the initial GitHub canary. Keep private repository names, infrastructure details, and credentials out of public examples and commits.
5. Verify repository rules still enforce the intended human review and stale-approval requirements. The service never sets these rules or merges a PR. Eligible low-risk reviews can publish a real GitHub approval.

## Map CI before enabling reviews

`ENG_AGENT_REQUIRED_CHECKS` contains exact check-run names or commit-status contexts, not workflow filenames. Every configured name must be present and successful on the reviewed head SHA.

The gate also waits for **all observed checks and statuses**, including those outside the required list. Failures block review; neutral and skipped checks block unless their exact names are explicitly allowlisted. A required check must still succeed even if its name is also in the skipped or neutral allowlist. Inspect conditional jobs on representative PRs before choosing these settings; missing required jobs can otherwise block indefinitely.

`ENG_AGENT_REPOSITORIES` remains the activation allowlist. Global branch, check, and confidence settings provide defaults. Set `ENG_AGENT_REPOSITORY_POLICIES` to a JSON object keyed by `owner/repository` to override `baseBranches`, `requiredSuccessChecks`, `allowedNeutralChecks`, `allowedSkippedChecks`, and `minimumConfidence` for each allowlisted repository. Omitted settings inherit defaults; supplied arrays replace them. Overrides do not activate repositories, and malformed settings stop policy evaluation. Deterministic path rules remain shared.

Installing the GitHub App on all repositories grants access to all of them; it does not add them to the runtime allowlist. Connect can still receive and bill webhook events from repositories the runtime ignores. Install on selected repositories if event volume or access scope should also be restricted.

## Run a live canary

Use disposable changes and inspect the GitHub check, review, and deployment logs. Do not merge the canary merely to complete this exercise.

| Case | Verify |
| --- | --- |
| Small clean documentation PR | Once checks pass, the assessment references the exact current SHA; approval occurs only if every policy gate passes. |
| Pending, failed, or skipped CI | No assessment is published while the check gate is blocked; configured exceptions behave as intended. |
| Conditional jobs and status-based CI | A passing check gate actually triggers review, including when a commit-status provider finishes last. |
| Human-only path | A clean change receives NEEDS HUMAN rather than approval. |
| Concrete defect | A supported medium/high finding produces REQUEST CHANGES. |
| New commit after approval | The old approval is dismissed or a visible warning reports dismissal failure; the new SHA receives a fresh assessment after CI. |
| Repeated event for the same SHA | The completed assessment is reused without duplicate reviews. |
| Draft, fork, or unresolved review thread | Automatic approval remains blocked. |

Automatic dispatch currently handles completed check suites and PR transitions to ready-for-review or reopened. Opening a PR alone does not dispatch a review; a new commit invalidates prior approvals and waits for subsequent CI activity. Commit-status completion has no dedicated dispatch handler. If a status provider finishes last and no review starts, treat that as an integration gap to resolve before expanding the pilot.

After the GitHub cases pass, optionally enable Slack and verify a single handoff for an eligible completed assessment. Findings requiring changes should not produce a reviewer-ready handoff. Track review usefulness, missed triggers, duplicate activity, latency, and model/sandbox cost before adding repositories.

## Stop or roll back

Remove the pilot repository from `ENG_AGENT_REPOSITORIES` (or set it empty) and redeploy to stop new automatic reviews and block subsequent decision submissions for that repository. Configuration changes do not cancel a publication already in progress or remove existing reviews. For an immediate stop, suspend the GitHub App installation or remove its access to the repository, then inspect and dismiss any outstanding bot approvals as appropriate. Leave existing human review requirements in place.

## What local validation proves

`npm run check` runs TypeScript checks, deterministic tests, and the Eve build. It does not prove connector permissions, event delivery, private checkout access, model availability, or live GitHub writes. `npm run eval` exercises live model behavior separately and can consume AI Gateway credits. A healthy `/eve/v1/health` endpoint proves the service runs; the canary verifies the complete installation.
