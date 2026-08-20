export interface BlockerGuidance {
  blockedBy: string;
  nextStep: string;
}

/** Lower rank = higher priority when choosing the primary next step. */
const BLOCKER_PRIORITY: readonly { match: (blocker: string) => boolean; rank: number }[] = [
  { match: (b) => b === "pull request has merge conflicts", rank: 10 },
  { match: (b) => b === "pull request is a draft", rank: 20 },
  { match: (b) => b === "pull request is not open", rank: 30 },
  { match: (b) => b === "an active changes-requested review exists", rank: 40 },
  { match: (b) => b.includes("unresolved review thread"), rank: 50 },
  { match: (b) => b === "review-thread resolution could not be verified", rank: 60 },
  { match: (b) => b === "configured check gate is not green", rank: 70 },
  { match: (b) => b === "fork pull requests require human approval", rank: 80 },
  { match: (b) => b.startsWith("repository ") && b.endsWith(" is not allowlisted"), rank: 90 },
  { match: (b) => b.startsWith("base branch ") && b.endsWith(" is not allowlisted"), rank: 100 },
  { match: (b) => b.startsWith("human-only surface: "), rank: 110 },
  { match: (b) => b.startsWith("autonomous reviewability limit: "), rank: 120 },
  { match: (b) => b.startsWith("risk is ") && b.endsWith(", not low"), rank: 130 },
  { match: (b) => b === "assessment confidence is below policy", rank: 140 },
];

export function formatBlockerGuidance(blocker: string, confidence: number): BlockerGuidance {
  if (blocker.includes("unresolved review thread")) {
    const count = blocker.match(/^(\d+)/u)?.[1] ?? "open";
    return {
      blockedBy:
        count === "1"
          ? "1 unresolved review thread"
          : `${count} unresolved review threads`,
      nextStep: "Resolve or reply to open review threads, then wait for a fresh risk assessment.",
    };
  }

  if (blocker === "assessment confidence is below policy") {
    return {
      blockedBy: `confidence ${(confidence * 100).toFixed(0)}% (needs 90%)`,
      nextStep:
        "No code change required for this gate — ask a reviewer to spot-check the assessment and approve.",
    };
  }

  if (blocker === "risk is medium, not low") {
    return {
      blockedBy: "risk is MEDIUM (only LOW can auto-approve)",
      nextStep: "Ask a qualified reviewer to approve; the change is clean but not bot-eligible.",
    };
  }

  if (blocker === "risk is high, not low") {
    return {
      blockedBy: "risk is HIGH (only LOW can auto-approve)",
      nextStep: "Ask a senior/qualified reviewer to approve; high-risk changes are never bot-approved.",
    };
  }

  if (blocker.startsWith("human-only surface: ")) {
    const reason = blocker.slice("human-only surface: ".length).trim();
    return {
      blockedBy: `human-only: ${reason}`,
      nextStep: "Request review from an owner of this surface; the bot cannot auto-approve these paths.",
    };
  }

  if (blocker.startsWith("autonomous reviewability limit: ")) {
    const reason = blocker.slice("autonomous reviewability limit: ".length).trim();
    return {
      blockedBy: `reviewability limit: ${reason}`,
      nextStep: "Split the PR or have a human reviewer approve the full diff.",
    };
  }

  if (blocker === "pull request has merge conflicts") {
    return {
      blockedBy: "pull request has merge conflicts",
      nextStep: "Rebase or merge the base branch, resolve conflicts, and push.",
    };
  }

  if (blocker === "pull request is a draft") {
    return {
      blockedBy: "pull request is a draft",
      nextStep: "Mark the PR ready for review, then wait for a fresh risk assessment.",
    };
  }

  if (blocker === "pull request is not open") {
    return {
      blockedBy: "pull request is not open",
      nextStep: "Reopen the PR if review should continue.",
    };
  }

  if (blocker === "an active changes-requested review exists") {
    return {
      blockedBy: "an active changes-requested review exists",
      nextStep: "Address the reviewer's comments and re-request review.",
    };
  }

  if (blocker === "review-thread resolution could not be verified") {
    return {
      blockedBy: "review-thread resolution could not be verified",
      nextStep: "Ask a human reviewer to confirm threads are resolved and approve.",
    };
  }

  if (blocker === "configured check gate is not green") {
    return {
      blockedBy: "configured check gate is not green",
      nextStep: "Fix failing or missing required checks on this head SHA, then wait for reassessment.",
    };
  }

  if (blocker === "fork pull requests require human approval") {
    return {
      blockedBy: "fork pull requests require human approval",
      nextStep: "A maintainer must review and approve from the upstream repository.",
    };
  }

  if (blocker.startsWith("repository ") && blocker.endsWith(" is not allowlisted")) {
    return {
      blockedBy: blocker,
      nextStep: "This repository is outside PR Review Agent automation scope; use normal human review.",
    };
  }

  if (blocker.startsWith("base branch ") && blocker.endsWith(" is not allowlisted")) {
    return {
      blockedBy: blocker,
      nextStep: "Target an allowlisted base branch, or use normal human review for this branch.",
    };
  }

  return {
    blockedBy: blocker.trim(),
    nextStep: "Ask a human reviewer to decide; the bot cannot auto-approve while this gate fails.",
  };
}

export function selectPrimaryBlocker(blockers: readonly string[]): string | null {
  if (blockers.length === 0) return null;
  let best = blockers[0]!;
  let bestRank = Infinity;
  for (const blocker of blockers) {
    const rank =
      BLOCKER_PRIORITY.find((entry) => entry.match(blocker))?.rank ?? 1_000;
    if (rank < bestRank) {
      best = blocker;
      bestRank = rank;
    }
  }
  return best;
}

export function formatNeedsHumanGuidance(
  blockers: readonly string[],
  confidence: number,
): {
  primary: BlockerGuidance;
  additional: readonly BlockerGuidance[];
  all: readonly BlockerGuidance[];
} {
  const unique = [...new Set(blockers.map((blocker) => blocker.trim()).filter(Boolean))];
  const primaryBlocker = selectPrimaryBlocker(unique) ?? "human judgment is required";
  const primary = formatBlockerGuidance(primaryBlocker, confidence);
  const additional = unique
    .filter((blocker) => blocker !== primaryBlocker)
    .map((blocker) => formatBlockerGuidance(blocker, confidence));
  return {
    primary,
    additional,
    all: [primary, ...additional],
  };
}
