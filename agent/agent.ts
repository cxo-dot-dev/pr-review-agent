import { defineAgent } from "eve";

export default defineAgent({
  model: "anthropic/claude-opus-4.8",
  // AI Gateway's context window for this model; keeps offline builds deterministic.
  // Update this value together with the model when selecting a different model.
  modelContextWindowTokens: 1_000_000,
  reasoning: "high",
  limits: {
    maxInputTokensPerSession: 1_000_000,
    maxOutputTokensPerSession: 80_000,
    sessionTimeoutMs: 14 * 24 * 60 * 60 * 1_000,
  },
});
