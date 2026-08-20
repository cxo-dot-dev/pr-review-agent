# Customization map

Use this checklist to translate repository evidence into PR Review Agent configuration.

| Evidence to inspect | Configure or edit | Validation |
| --- | --- | --- |
| GitHub `owner/repo` names and protected branches | `ENG_AGENT_REPOSITORIES`, `ENG_AGENT_BASE_BRANCHES` | Out-of-scope repository and branch remain ignored |
| Required workflow/job names as displayed in GitHub | `ENG_AGENT_REQUIRED_CHECKS` | Missing, pending, failed, neutral, and skipped cases |
| Intentionally acceptable neutral/skipped jobs | Allowed-check environment variables | Only named jobs bypass the default block |
| Migration/schema directories | `HIGH_PATH_RULES`, `HUMAN_ONLY_PATH_RULES` | Representative paths receive high floor and human review |
| Auth, authorization, tenant, secret, privacy paths | Medium/high and human-only rules | Trust-boundary paths cannot auto-approve |
| Billing, payment, entitlement, identity mutations | High and human-only rules | Mutation paths are high; read-only reports are not promoted by nouns alone |
| Infrastructure, deployment, queues, schedulers | Risk floors and calibration | Hard-to-recover control-plane changes require humans |
| Docs, tests, generated assets, translations | Constrained-surface detection | Large constrained diffs do not consume reviewability budget |
| Framework routes, server actions, workers, jobs | Medium rules | Runtime behavior gets at least the intended floor |
| Monorepo packages and ownership boundaries | Path rules and instructions | Package-specific sensitive surfaces are covered |
| Team confidence tolerance | `ENG_AGENT_MIN_CONFIDENCE` | Below-threshold result becomes `NEEDS HUMAN`, not higher risk |
| GitHub ownership, Slack destination, and reviewer groups | `CODEOWNERS`, GitHub review requests, and Slack environment variables | Blank channel disables delivery; no group gives a channel-only handoff; exact repository group overrides global fallback; delivery is idempotent |

Keep `agent/skills/pr-risk-review/references/scoring.md`, `agent/lib/risk-calibration.ts`, tests, and `docs/risk-policy.md` consistent whenever rating or aggregation semantics change. Bump `POLICY_VERSION` for a deployed policy change so old exact-SHA assessments cannot be mistaken for current ones.

## Implementation locations

- Edit `HIGH_PATH_RULES`, `MEDIUM_PATH_RULES`, and `HUMAN_ONLY_PATH_RULES` in `agent/lib/risk-policy.ts`. They are JavaScript regular expressions matched against repository-relative POSIX paths, not glob patterns.
- Edit `isDocumentation`, `isDocumentationOrTest`, and `isConstrainedSurface` in the same file for generated or non-runtime surfaces. Documentation and tests are filtered before deterministic runtime path floors are applied.
- Edit `RISK_CALIBRATION` and `detectRiskArchetypes` in `agent/lib/risk-calibration.ts` for model-facing consequence guidance and recognizable local archetypes.
- Add table-driven path examples to `tests/risk-policy.test.ts` and archetype cases to `tests/risk-calibration.test.ts`. Include near-miss cases that must stay low or medium.

Path names alone cannot always distinguish reads from writes. Prefer narrow mutation paths such as `services/billing/commands/`, `services/billing/webhooks/`, or named cancellation/update handlers. If a repository mixes reads and writes under one directory, keep the broad path human-only until the code is reorganized or add content-aware inspection guidance rather than declaring every billing read high risk.
