import { connectGitHubCredentials } from "@vercel/connect/eve";
import { githubConnectorUid } from "./config";

export const githubCredentials = connectGitHubCredentials(githubConnectorUid());

export async function githubInstallationToken(): Promise<string> {
  const source = githubCredentials.installationToken;
  if (!source) throw new Error("The GitHub Connect installation token is not configured.");
  return typeof source === "function" ? await source() : source;
}
