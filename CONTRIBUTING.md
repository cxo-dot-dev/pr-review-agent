# Contributing

Contributions to documentation, tests, integrations, and review behavior are welcome. For substantial changes, open an issue describing the problem and proposed approach before investing in an implementation. Small fixes can go straight to a pull request.

## Local setup

Use Node.js 24 or newer and npm. From your checkout:

```bash
npm ci --ignore-scripts
npm run check
```

The deterministic tests use fixtures and mocked integrations. You do not need live GitHub or Vercel credentials to run them. See the [README](README.md) for deployment configuration; copy `.env.example` to `.env.local` only when you need local configuration, and keep credentials out of version control.

## Find the relevant code

- `agent/channels/` receives events and decides when to start a review.
- `agent/lib/` implements configuration, GitHub API access, policy, and publication.
- `agent/tools/` exposes review operations to the model.
- `agent/instructions.md` guides the deployed agent.
- `tests/` contains deterministic tests and reusable fixtures.
- `docs/` explains installation, policy, and live testing.

Read [AGENTS.md](AGENTS.md) for contributor safety rules and [the risk policy](docs/risk-policy.md) before changing approval behavior. Keep approval decisions deterministic, preserve the repository allowlist, and fail closed when required data is incomplete. Changes to policy semantics should update `POLICY_VERSION`, regression tests, and the corresponding documentation together.

## Validate changes

Run a focused test while developing:

```bash
npm test -- tests/config.test.ts
```

Before submitting code changes, run:

```bash
npm run check
git diff --check
```

`npm run check` runs TypeScript checks, the deterministic test suite, and the Eve build. CI runs the same command. Add regression tests that demonstrate the behavior being fixed, especially for approval gates, incomplete API responses, and publication side effects.

For documentation-only changes, check instructions against the implementation, verify links, and run `git diff --check`; unrelated tests do not need to be rerun.

Live testing is separate. `npm run eval` uses a model and can incur charges; the current conversational smoke test does not establish review accuracy. Follow the [dogfooding guide](docs/dogfooding.md) for end-to-end testing. Live canaries can publish actual GitHub reviews and consume service credits. Do not deploy or enable repositories merely to validate an unrelated contribution.

## Keep contributions safe to publish

Use fictional repository names, generic check names, and synthetic fixtures. Do not include private code, customer data, credentials, internal infrastructure details, or deployment identifiers in commits, screenshots, logs, issues, or pull requests. Deployment-specific configuration belongs in environment variables, not reusable defaults.

Review your staged diff and file list before pushing. Local environment files, `.vercel/`, dependencies, and generated build output must remain untracked. Do not post exploitable vulnerability details or secrets in a public issue.

## Submit a pull request

Keep each PR focused on a concrete problem. Explain the resulting behavior, include a before/after example when useful, and report the validation you actually performed. Call out changes to approval decisions, permissions, configuration compatibility, or external side effects, along with any integration behavior that remains untested.

Bug reports should include a minimal reproduction, expected and actual behavior, relevant versions, and sanitized logs. Label synthetic examples clearly so reviewers can reproduce the issue without access to private repositories.
