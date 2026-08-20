# Slack review notifications

After an exact-SHA decision is published to GitHub, the agent can post a concise handoff to one Slack channel. Slack delivery is downstream of the GitHub decision: a Slack failure never changes or rolls back the review.

GitHub review requests and `CODEOWNERS` remain the source of truth for who owns a review. By default, the Slack message is a channel-only handoff and mentions no individual reviewer. Teams that want an active notification can mention one maintained Slack user group globally or route different repositories to different user groups. This scales without duplicating a changing employee roster in deployment configuration.

Low-risk PRs that passed every approval gate are labeled **Bot approved — human approval still required**. Clean changes that are not bot-eligible are labeled **Human review required**. PRs with substantive findings receive `REQUEST CHANGES` on GitHub and are not sent to the reviewer-ready channel until the findings are fixed.

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
# Optional global fallback, using a Slack user group ID rather than a member ID.
ENG_AGENT_SLACK_REVIEWER_GROUP_ID=S012ABC
# Optional exact repository overrides. Keys are case-insensitive owner/repository names.
ENG_AGENT_SLACK_REPOSITORY_REVIEWER_GROUPS={"your-org/frontend":"S345DEF","your-org/backend":"S678GHI"}
```

Use Slack user group IDs, not display names or individual member IDs. Exact repository mappings override the global fallback. If neither is configured, the message directs readers to GitHub for ownership without mentioning anyone. Invite the Slack app to the configured channel, and ensure each chosen user group is appropriate for that channel.

Avoid `@channel` and `@here`: reviewer groups are easier to maintain and create less notification noise. Leave `ENG_AGENT_SLACK_REVIEW_CHANNEL` blank to disable delivery safely.
