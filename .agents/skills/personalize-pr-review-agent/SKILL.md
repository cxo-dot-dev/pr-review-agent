---
name: personalize-pr-review-agent
description: Adapt the open-source PR Review Agent to a team's repositories, languages, frameworks, CI checks, developer tools, sensitive code paths, and tolerance for engineering risk. Use when setting up this repository for a new organization, adding a stack or monorepo, changing approval thresholds, or auditing whether the default policy matches local deployment, data, security, and operational priorities.
---

# Personalize PR Review Agent

Configure the agent from evidence in the target repositories. Preserve its exact-SHA checks, deterministic gates, auditable output, and no-merge boundary.

## Workflow

1. Read `README.md`, `.env.example`, `docs/risk-policy.md`, `agent/lib/config.ts`, `agent/lib/risk-policy.ts`, `agent/lib/risk-calibration.ts`, and `agent/skills/pr-risk-review/`.
2. Inspect each target repository before editing. Identify languages, package managers, frameworks, database and migration tools, auth/payment providers, infrastructure paths, CI workflow names, generated files, test conventions, monorepo boundaries, and protected branches.
3. Read [references/customization-map.md](references/customization-map.md) and build a short proposed mapping from observed stack surface to agent configuration.
4. Ask only for decisions that cannot be inferred safely: repositories to allowlist, acceptable base branches, exact required checks, reviewers, and which consequences the team treats as human-only. Default uncertain sensitive surfaces to human-only.
5. Update `.env.example` with realistic placeholders, never credentials or production IDs. Keep the runtime's empty repository default so an unconfigured deployment stays inert.
6. Adapt path rules and calibration examples to observed architecture. Prefer consequence-based rules over vendor-name matching. Treat reads differently from mutations, and keep diff size separate from risk.
7. Add or update focused tests for every new risk floor, human-only rule, constrained/generated path, and configuration behavior. Replace generic examples only when repository evidence supports better ones.
8. Update `docs/risk-policy.md` and deployment examples so they describe the implemented policy exactly.
9. Run `npm run check`, the skill validator, and a case-insensitive scan for template placeholders or prior organization/person names. Report any live connector or GitHub canary that remains unverified.

## Guardrails

- Do not add repository contents write, workflows write, administration, deployment write, or merge-bypass permissions.
- Do not make the bot merge, publish, deploy, or change branch protection.
- Do not allowlist neutral/skipped checks without a concrete reason.
- Do not lower thresholds merely to make an example PR auto-approvable.
- Do not encode personal names or private channel IDs in source-controlled defaults.
- Keep secrets in Vercel environment variables or Vercel Connect, never tracked files.
- Require human review for ambiguous trust boundaries, durable mutations, destructive operations, and hard-to-recover production control-plane changes.

## Completion report

Summarize the stack and policy mapping, files changed, tests run, and the remaining operator steps. Separate local verification from deployed GitHub/Vercel acceptance.
