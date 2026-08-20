import { defineEval } from "eve/evals";
import { includes } from "eve/evals/expect";

export default defineEval({
  description: "The root agent presents itself as a general engineering review agent.",
  tags: ["smoke"],
  async test(t) {
    await t.send("Briefly explain how you can help engineers review pull requests.");
    t.succeeded();
    t.check(t.reply, includes(/engineering|repository|pull request/i));
  },
});
