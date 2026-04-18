import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AGENT_ADAPTER_TYPES,
  AGENT_ROLES,
  AGENT_STATUSES,
  APPROVAL_STATUSES,
  APPROVAL_TYPES,
  COMPANY_STATUSES,
  HEARTBEAT_RUN_STATUSES,
  ISSUE_STATUSES,
  ROUTINE_CATCH_UP_POLICIES,
  ROUTINE_CONCURRENCY_POLICIES,
} from "@paperclipai/shared";
import { listServerAdapters } from "../adapters/index.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const NARRATIVE_PATH = path.resolve(
  HERE,
  "../onboarding-assets/operator-context/OPERATOR.md",
);
const FIRST_RUN_PATH = path.resolve(
  HERE,
  "../onboarding-assets/operator-context/FIRST_RUN.md",
);
const HIRING_PLAYBOOK_PATH = path.resolve(
  HERE,
  "../onboarding-assets/ceo/HIRING_PLAYBOOK.md",
);

let narrativeCache: string | null = null;
let firstRunCache: string | null = null;
let hiringPlaybookCache: string | null = null;

async function loadNarrative(): Promise<string> {
  if (narrativeCache !== null) return narrativeCache;
  narrativeCache = await readFile(NARRATIVE_PATH, "utf8");
  return narrativeCache;
}

async function loadFirstRun(): Promise<string> {
  if (firstRunCache !== null) return firstRunCache;
  firstRunCache = await readFile(FIRST_RUN_PATH, "utf8");
  return firstRunCache;
}

async function loadHiringPlaybook(): Promise<string> {
  if (hiringPlaybookCache !== null) return hiringPlaybookCache;
  hiringPlaybookCache = await readFile(HIRING_PLAYBOOK_PATH, "utf8");
  return hiringPlaybookCache;
}

export async function buildFirstRunGuide(): Promise<string> {
  return loadFirstRun();
}

export async function buildHiringPlaybook(): Promise<string> {
  return loadHiringPlaybook();
}

function bulletList(values: readonly string[]): string {
  return values.map((value) => `- \`${value}\``).join("\n");
}

function buildDynamicSection(): string {
  const registeredAdapters = listServerAdapters()
    .map((adapter) => adapter.type)
    .sort();

  const sections: string[] = [
    "## Live enums (stitched at request time)",
    "",
    "The following lists come directly from this server's code and change as the server is updated. Compare them against the narrative above if something mentioned in the narrative doesn't appear here — that means it was removed.",
    "",
    "### Company status values",
    bulletList(COMPANY_STATUSES),
    "",
    "### Agent status values",
    bulletList(AGENT_STATUSES),
    "",
    "### Agent roles",
    bulletList(AGENT_ROLES),
    "",
    "### Agent adapter types (defined by shared constants)",
    bulletList(AGENT_ADAPTER_TYPES),
    "",
    "### Adapters registered on this server instance",
    registeredAdapters.length > 0
      ? bulletList(registeredAdapters)
      : "_(no adapters registered)_",
    "",
    "### Issue status values",
    bulletList(ISSUE_STATUSES),
    "",
    "### Heartbeat run status values",
    bulletList(HEARTBEAT_RUN_STATUSES),
    "",
    "Terminal heartbeat run statuses (used by execution-lock stale recovery):",
    bulletList(["succeeded", "failed", "cancelled", "timed_out"]),
    "",
    "### Approval types",
    bulletList(APPROVAL_TYPES),
    "",
    "### Approval statuses",
    bulletList(APPROVAL_STATUSES),
    "",
    "### Routine concurrency policies",
    bulletList(ROUTINE_CONCURRENCY_POLICIES),
    "",
    "### Routine catch-up policies",
    bulletList(ROUTINE_CATCH_UP_POLICIES),
    "",
  ];
  return sections.join("\n");
}

export async function buildOperatorContext(): Promise<string> {
  const narrative = await loadNarrative();
  const dynamic = buildDynamicSection();
  return `${narrative.trimEnd()}\n\n${dynamic}`;
}

export interface OperatorProfileInput {
  subscriptionOnly?: boolean;
  claudeSubscription?: string | null;
  codexSubscription?: string | null;
  preferences?: Record<string, unknown>;
}

export async function buildSetupRecipe(profile?: OperatorProfileInput): Promise<string> {
  const hiringPlaybook = await loadHiringPlaybook();
  const registeredAdapters = listServerAdapters()
    .map((adapter) => adapter.type)
    .sort();

  const isSubscriptionOnly = profile?.subscriptionOnly !== false;
  const claudeSub = profile?.claudeSubscription ?? null;
  const codexSub = profile?.codexSubscription ?? null;

  const operatorName =
    typeof profile?.preferences === "object" &&
    profile.preferences !== null &&
    typeof (profile.preferences as Record<string, unknown>).displayName === "string"
      ? (profile.preferences as Record<string, unknown>).displayName as string
      : "this operator";

  // Section 1 — who the recipe is for
  const header = [
    "# Paperclip Setup Recipe",
    "",
    `You are onboarding projects for ${operatorName}.`,
    "",
  ];

  // Section 2 — operator context
  const billingLabel = isSubscriptionOnly ? "subscription-only (no API billing)" : "API billing enabled";
  const subscriptionLines: string[] = [];
  if (claudeSub) subscriptionLines.push(`- Claude subscription: **${claudeSub}**`);
  if (codexSub) subscriptionLines.push(`- Codex (OpenAI) subscription: **${codexSub}**`);
  if (subscriptionLines.length === 0) subscriptionLines.push("- No subscriptions declared (defaults apply)");

  const operatorSection = [
    "## Operator context",
    "",
    `Billing mode: **${billingLabel}**`,
    "",
    "Declared subscriptions:",
    ...subscriptionLines,
    "",
  ];

  // Section 3 — recommended adapter defaults
  const adapterRecommendation = isSubscriptionOnly
    ? "Prefer `codex_local` for coding workers and `claude_local` for reviewer/research/reasoning roles. Do NOT hire agents on API-billed adapters (e.g. any adapter not listed as subscription-backed)."
    : "All adapters are available. Choose based on task requirements.";

  const adapterSection = [
    "## Recommended adapter defaults",
    "",
    adapterRecommendation,
    "",
    "Adapters registered on this server instance:",
    ...registeredAdapters.map((a) => `- \`${a}\``),
    "",
    // NOTE: billingMode per adapter is not yet available (P1 not merged).
    // TODO(P1): once P1 ships, filter this list to subscription-backed adapters when subscriptionOnly=true.",
  ];

  // Section 4 — hiring profiles (from playbook)
  const profilesSection = [
    "## Recommended hiring profiles",
    "",
    "The full hiring playbook follows. When subscription-only mode is active, prefer profiles that use `codex_local` or `claude_local` adapters.",
    "",
    hiringPlaybook.trimEnd(),
    "",
  ];

  // Section 5 — reviewer pattern
  const reviewerSection = [
    "## Reviewer pattern",
    "",
    "Every project should have a dedicated reviewer agent hired with the `reviewer` profile (`claude_local`, Opus 4.7, effort=high, webSearch=true). Set the company's `defaultReviewerAgentId` to this agent after hiring. The reviewer is cross-adapter — it reviews work from any specialist regardless of which adapter they run on.",
    "",
  ];

  // Section 6 — per-project overlay expectations
  const overlaySection = [
    "## Per-project overlay expectations",
    "",
    "Each managed repository may contain a `.paperclip/ceo/` directory with project-specific CEO instruction overrides (AGENTS.md, HEARTBEAT.md, etc.). These files replace the server defaults at hire time. If the overlay directory does not exist yet, the defaults are used.",
    "",
    "On first heartbeat the CEO should read the repo and call `paperclipRefineCeoOverlay` to update its own overlay with project-specific details (commands, paths, architecture notes).",
    "",
    // NOTE: archetype registry integration is deferred (R1 not merged).
    // TODO(R1): once R1 ships, include the archetype-to-team-shape mapping here.",
  ];

  // Section 7 — canonical recipe paragraph
  const recipeSection = [
    "## Canonical onboarding recipe",
    "",
    "For each project: call `paperclipOnboardPortfolio` with the repo path, ensuring the operator's subscription profile is reflected (subscription-only operators will have codex_local/claude_local adapters auto-selected). The call idempotently creates a company, hires a CEO + reviewer, pre-hires team-shape workers, writes the `.paperclip/ceo/` overlay, and sets `defaultHireAdapter`, `autoReviewEnabled`, and `defaultReviewerAgentId` on the company. Re-running the call on an already-onboarded project is safe — it reports `status: \"skipped\"` and ensures settings are correct without duplicating agents.",
    "",
  ];

  const sections = [
    ...header,
    ...operatorSection,
    ...adapterSection,
    ...profilesSection,
    ...reviewerSection,
    ...overlaySection,
    ...recipeSection,
  ];

  return sections.join("\n");
}

export function resetOperatorContextCacheForTests(): void {
  narrativeCache = null;
  firstRunCache = null;
  hiringPlaybookCache = null;
}
