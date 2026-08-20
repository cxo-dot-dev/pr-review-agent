# GitHub App configuration

Use Vercel Connect to provision and operate the GitHub App. Attach trigger delivery to:

```text
https://<eng-agent-deployment>/eve/v1/github
```

## Repository permissions

| Permission | Access | Why |
| --- | --- | --- |
| Metadata | Read | Repository identity |
| Contents | Read | PR checkout and surrounding-code review |
| Pull requests | Read and write | Read diffs/reviews and submit COMMENT/APPROVE reviews |
| Checks | Read and write | Read CI and publish the risk assessment check |
| Issues | Read and write | Respond to timeline mentions and post safety warnings |

Do not grant contents write, workflows write, administration, deployments write, or merge bypass.

## Webhook events

- Pull request
- Check suite
- Issue comment
- Pull request review comment

The app ignores its own webhook activity and duplicate assessments.

## Installation scope

Install on selected repositories rather than every organization repository. Runtime automation is independently restricted by `ENG_AGENT_REPOSITORIES` and `ENG_AGENT_BASE_BRANCHES`.
