import type { ApprovalDecision } from "./decision";
import type { FinalRisk } from "./risk-policy";

export const APPROVE_HANDOFF = {
  why: "Low risk, sufficient confidence, and every approval gate passed.",
  nextStep: "PR Review Agent cannot merge. GitHub still needs one qualifying human approval.",
} as const;

export function decisionEmoji(
  decision: ApprovalDecision,
  band: FinalRisk["band"],
): string {
  if (decision.disposition === "approve") return "✨";
  if (decision.disposition === "request_changes") return "🛠️";
  if (band === "high") return "🚨";
  if (band === "medium") return "🧭";

  const blockers = decision.blockers.join(" ").toLowerCase();
  if (blockers.includes("merge conflict")) return "🚧";
  if (blockers.includes("unresolved review thread")) return "💬";
  if (blockers.includes("confidence")) return "🔎";
  return "👀";
}
