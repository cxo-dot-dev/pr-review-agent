# PR Review Agent

An open-source, self-hosted engineering agent that reviews GitHub pull requests by risk. It runs on [Eve](https://eve.dev) and Vercel, receives signed GitHub App webhooks through Vercel Connect, checks out the exact PR head in an isolated Vercel Sandbox, and publishes an auditable review.

> **Use at your own risk.** This software is provided “as is,” without warranty of any kind, as described in the [MIT license](LICENSE). Automated reviews can miss defects or produce incorrect findings; an approval is not a guarantee of correctness or security. Validate the agent for your repositories and retain appropriate human review and repository protections.

The agent:

- waits for your required checks to be present and green on the current head SHA;
- applies deterministic risk floors, human-only path rules, and a separate reviewability gate;
- rates change complexity, blast radius, data/security, operational/recovery risk, and verification as very low, low, medium, or high;
- aggregates the overall risk from the highest consequential rating, deterministic policy floor, and finding severity;
- chooses `APPROVE`, `REQUEST CHANGES`, or `NEEDS HUMAN` deterministically;
- can notify a configured Slack channel after a review decision; and
- never merges a PR or changes repository rules.

## Risk model

| Level | Meaning | Action |
| --- | --- | --- |
| Very low | Minimal consequence and immediate recovery | Approve only when every non-risk gate also passes |
| Low | Contained consequence and straightforward recovery | Approve only when every non-risk gate also passes |
| Medium | Meaningful impact that needs human judgment | Publish the assessment and require human approval |
| High | Trust-boundary, broad, durable, or difficult-to-recover impact | Publish the assessment and require human approval |

The overall level is the highest of the five area ratings, any deterministic path-policy floor, and any substantive finding. Risk is deliberately not averaged: a high data/security rating cannot be canceled out by very-low ratings elsewhere.

Risk describes consequence and recoverability. Confidence, required checks, reviewability, human-only paths, and repository gates can require a human without inflating the risk band. See [docs/risk-policy.md](docs/risk-policy.md) for the baseline policy.

## Prerequisites

- Node.js 24 or newer
- a Vercel account and team with access to Vercel Connect, Sandbox, and AI Gateway
- a GitHub organization or account where you can install a GitHub App
- the [Vercel CLI](https://vercel.com/docs/cli) authenticated to the target team

## Configure the agent

Install dependencies and copy the example configuration:

```bash
npm ci --ignore-scripts
cp .env.example .env.local
```

At minimum, set these values:

```dotenv
ENG_AGENT_REPOSITORIES=your-org/repository-one,your-org/repository-two
ENG_AGENT_BASE_BRANCHES=main
ENG_AGENT_REQUIRED_CHECKS=lint,test
```

Repository names and required check names must match GitHub exactly. The default repository allowlist is empty, so an unconfigured deployment does not start automatic reviews. Keep neutral and skipped check allowlists empty unless you have explicitly decided those conclusions are safe.

For multiple repositories, use `ENG_AGENT_REPOSITORY_POLICIES` to override branches, checks, and confidence by repository while retaining the explicit activation allowlist. See [.env.example](.env.example) and the [dogfooding guide](docs/dogfooding.md#map-ci-before-enabling-reviews). Keep private repository settings in Vercel environment variables.

To tailor path rules, review thresholds, check names, Slack routing, and agent instructions to your stack, invoke the included [`personalize-pr-review-agent` skill](.agents/skills/personalize-pr-review-agent/SKILL.md):

```text
Use $personalize-pr-review-agent to configure this agent for our TypeScript monorepo,
GitHub Actions checks, Postgres migrations, Stripe billing, and high sensitivity to auth changes.
```

## Deploy to Vercel

Run all commands from this repository root so Vercel Connect can attach connectors to the correct project.

### 1. Link the Vercel project

```bash
npx eve link
```

Select the intended Vercel team and create or select the project when prompted. `eve link` requires an interactive terminal. Confirm the generated `.vercel/project.json` points to the intended project and team; `.vercel/` is intentionally ignored.

### 2. Create and attach the GitHub connector

```bash
vercel connect create github --triggers
vercel connect list
vercel connect attach <github-connector-id> --environment production --triggers --trigger-path /eve/v1/github
```

Complete the browser flow, choose a stable UID such as `github/pr-review-agent`, and install the managed GitHub App only on the repositories the agent should read. Configure its permissions and webhook events from [docs/github-app.md](docs/github-app.md), then set:

```dotenv
ENG_AGENT_GITHUB_CONNECTOR=github/pr-review-agent
ENG_AGENT_BOT_NAME=the-installed-github-app-slug
```

Attach the connector's webhook trigger to:

```text
/eve/v1/github
```

The connector UID and GitHub App slug are different values. `ENG_AGENT_GITHUB_CONNECTOR` selects Vercel Connect credentials; `ENG_AGENT_BOT_NAME` prevents the agent from reacting to its own GitHub events.

### 3. Add environment variables

Add every `ENG_AGENT_*` value from [.env.example](.env.example) to the Vercel project for Production. Use Preview too if you will run webhook canaries against preview deployments.

```bash
vercel env add ENG_AGENT_REPOSITORIES production
vercel env add ENG_AGENT_BASE_BRANCHES production
vercel env add ENG_AGENT_REQUIRED_CHECKS production
vercel env add ENG_AGENT_GITHUB_CONNECTOR production
vercel env add ENG_AGENT_BOT_NAME production
```

Pull the project environment for local testing. Vercel Connect uses the short-lived `VERCEL_OIDC_TOKEN` supplied by Vercel; no GitHub private key, installation token, or webhook secret belongs in this repository.

```bash
vercel env pull .env.local --environment=development --yes
```

### 4. Optionally connect Slack

```bash
vercel connect create slack
vercel connect list
vercel connect attach <slack-connector-id>
```

Invite the Slack app to the destination channel and set the connector UID and channel ID. By default, Slack is a channel-only handoff: GitHub review requests and `CODEOWNERS` remain the source of truth for ownership. To notify a scalable reviewer pool, configure one maintained Slack user group globally or map repositories to different user groups. Leave `ENG_AGENT_SLACK_REVIEW_CHANNEL` blank to disable Slack safely. See [docs/slack-review-notifications.md](docs/slack-review-notifications.md).

### 5. Verify and deploy

```bash
npm run check
npx eve deploy
```

`eve deploy` deploys to Production using the linked project and team.

After deployment:

1. Open `https://<deployment>/eve/v1/health` and confirm the agent is healthy.
2. Open a disposable PR in an allowlisted repository and let every configured required check finish.
3. Confirm the GitHub check and review both reference the PR's current head SHA.
4. Push a new commit and confirm the old automated approval is dismissed or visibly marked stale.
5. If Slack is enabled, confirm exactly one reviewer-ready message appears for that SHA.

A healthy endpoint proves the service is running; the disposable PR is the acceptance test for connector permissions, event delivery, sandbox checkout, policy evaluation, and GitHub writes.

For a first-repository pilot, follow the [dogfooding guide](docs/dogfooding.md) to map CI checks, exercise the canary cases, and stop the rollout if needed.

## Local verification

```bash
npm run check
```

This runs TypeScript, deterministic tests, and `eve build`. Live model evals are separate and may consume AI Gateway credits:

```bash
npm run eval
```

## Security boundary

The GitHub App needs read access to code and write access to pull-request reviews and checks. It does not need contents write, workflows write, administration, deployments write, or merge bypass. The service never changes branch protection and never merges. Repository-enforced stale-review dismissal and required status checks remain the strongest final controls.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for local setup, testing, and pull request guidance. Coding agents should also read [AGENTS.md](AGENTS.md).

## License

[MIT](LICENSE)
