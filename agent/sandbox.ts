import { defineSandbox } from "eve/sandbox";
import { vercel } from "eve/sandbox/vercel";

export default defineSandbox({
  backend: vercel({
    networkPolicy: {
      allow: [
        "github.com",
        "api.github.com",
        "*.githubusercontent.com",
        "registry.npmjs.org",
      ],
      subnets: {
        deny: ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"],
      },
    },
  }),
  async onSession({ use }) {
    const sandbox = await use();
    const result = await sandbox.run({
      command: "git config --global --replace-all safe.directory /workspace",
    });
    if (result.exitCode !== 0) {
      throw new Error(
        `Could not configure the sandbox checkout directory as safe: ${result.stderr || result.stdout}`,
      );
    }
  },
});
