import type { ToolContext } from "eve/tools";

export interface GitHubSessionTarget {
  owner: string;
  repo: string;
  pullNumber: number;
  repository: string;
}

export function githubSessionTarget(ctx: Pick<ToolContext, "session">): GitHubSessionTarget {
  const attributes = ctx.session.auth.current?.attributes ?? ctx.session.auth.initiator?.attributes;
  const repository = stringAttribute(attributes, "repository");
  const pullNumberValue = stringAttribute(attributes, "pull_request_number");
  const [owner, repo, extra] = repository.split("/");
  const pullNumber = Number(pullNumberValue);

  if (!owner || !repo || extra || !Number.isSafeInteger(pullNumber) || pullNumber <= 0) {
    throw new Error("This tool requires a GitHub pull-request session.");
  }

  return { owner, repo, pullNumber, repository };
}

function stringAttribute(
  attributes: Readonly<Record<string, unknown>> | undefined,
  key: string,
): string {
  const value = attributes?.[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`GitHub session attribute ${key} is missing.`);
  }
  return value;
}
