# Slack review notifications

After an exact-SHA decision is published to GitHub, the agent can post a concise handoff to one Slack channel. Slack delivery is downstream of the GitHub decision: a Slack failure never changes or rolls back the review.

All configured reviewers are mentioned for reviewer-ready PRs. Low-risk PRs that passed every approval gate are labeled **Bot approved — human approval still required**. Clean changes that are not bot-eligible are labeled **Human review required**. PRs with substantive findings receive `REQUEST CHANGES` on GitHub and are not sent to the reviewer-ready channel until the findings are fixed.

Every message includes the PR link, author, one-sentence summary, overall categorical risk, check status, and next action. A deterministic client message ID derived from policy version, repository, PR number, and head SHA makes repeat delivery idempotent.

## Configuration

Create and attach a Slack Vercel Connect connector from the project directory:

```bash
vercel connect create slack
vercel connect list
vercel connect attach <slack-connector-id>
```

Then configure:

```dotenv
ENG_AGENT_SLACK_CONNECTOR=slack/pr-review-agent
ENG_AGENT_SLACK_REVIEW_CHANNEL=C0123456789
ENG_AGENT_SLACK_REVIEWER_IDS=U0123456789,U9876543210
```

Use Slack member IDs, not display names. Invite the Slack app to the configured channel. Leave `ENG_AGENT_SLACK_REVIEW_CHANNEL` blank to disable delivery safely; `ENG_AGENT_SLACK_REVIEWER_IDS` may be blank if you want an unassigned channel notification.
