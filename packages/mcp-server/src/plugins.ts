/**
 * Plugin filter + recommendation logic.
 *
 * Recommendation signals (all optional / best-effort):
 *  - operator profile: subscriptionOnly flag, preferences keywords
 *  - project archetype: stack, tags (e.g. github remote → github-issues plugin)
 */

import { PLUGIN_CATALOG, type PluginCatalogEntry, type PluginCategory } from "./plugin-catalog.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PluginFilterInput {
  category?: PluginCategory;
  subscriptionCompatible?: boolean;
  tags?: string[];
}

export interface OperatorProfileSignal {
  subscriptionOnly?: boolean | null;
  preferences?: Record<string, unknown> | null;
}

export interface ArchetypeSignal {
  /** e.g. "pnpm-monorepo", "npm-single" */
  stack?: string;
  /** raw tags or keywords extracted from the archetype */
  tags?: string[];
}

// ---------------------------------------------------------------------------
// Filter
// ---------------------------------------------------------------------------

/**
 * Return all catalog entries matching the given filter.  When a filter field
 * is absent or undefined, it is not applied (i.e. all values pass).
 */
export function filterPlugins(filter?: PluginFilterInput): PluginCatalogEntry[] {
  if (!filter) return PLUGIN_CATALOG;

  return PLUGIN_CATALOG.filter((entry) => {
    if (filter.category !== undefined && entry.category !== filter.category) {
      return false;
    }
    if (
      filter.subscriptionCompatible !== undefined &&
      entry.subscriptionCompatible !== filter.subscriptionCompatible
    ) {
      return false;
    }
    if (filter.tags && filter.tags.length > 0) {
      const entryTagSet = new Set(entry.tags);
      const matches = filter.tags.some((t) => entryTagSet.has(t));
      if (!matches) return false;
    }
    return true;
  });
}

// ---------------------------------------------------------------------------
// Scoring helpers
// ---------------------------------------------------------------------------

/**
 * Compute a simple relevance score for an entry against the given signals.
 * Higher = more relevant.
 */
function scoreEntry(
  entry: PluginCatalogEntry,
  profile: OperatorProfileSignal | null,
  archetype: ArchetypeSignal | null,
): number {
  let score = 0;

  // Subscription compatibility is a gate: if the operator is subscription-only
  // and the plugin is not compatible, we drop the score to zero.
  if (profile?.subscriptionOnly === true && !entry.subscriptionCompatible) {
    return 0;
  }

  // Boost entries whose tags match signals from the archetype.
  const archetypeTags = new Set(archetype?.tags ?? []);
  const archetypeStack = archetype?.stack?.toLowerCase() ?? "";

  // github remote → github-issues plugin
  if (archetypeStack.includes("github") && entry.tags.includes("github")) score += 3;
  if (archetypeStack.includes("github") && entry.id === "paperclip-plugin-github-issues") score += 2;

  // pnpm-monorepo or npm stacks — tools and analytics tend to be useful
  if (
    (archetypeStack.includes("pnpm") || archetypeStack.includes("npm")) &&
    entry.category === "tools"
  )
    score += 1;

  // Match tags from archetype scan
  for (const tag of archetypeTags) {
    if (entry.tags.includes(tag)) score += 2;
  }

  // Boost notification plugins a little since they're broadly useful
  if (entry.category === "notifications") score += 1;

  // Boost memory plugin — broadly useful for persistent agent context
  if (entry.id === "paperclip-plugin-hindsight") score += 1;

  // If preferences mention a keyword matching an entry tag, boost
  if (profile?.preferences) {
    const prefStr = JSON.stringify(profile.preferences).toLowerCase();
    for (const tag of entry.tags) {
      if (prefStr.includes(tag)) score += 2;
    }
  }

  return score;
}

// ---------------------------------------------------------------------------
// Recommendations
// ---------------------------------------------------------------------------

/**
 * Return a list of recommended plugins, sorted by relevance.
 * Entries with score=0 are excluded.
 * @param limit How many entries to return (default 16 — the full catalog minus zeroes).
 */
export function recommendPlugins(
  profile: OperatorProfileSignal | null,
  archetype: ArchetypeSignal | null,
  limit = 16,
): PluginCatalogEntry[] {
  const scored = PLUGIN_CATALOG.map((entry) => ({
    entry,
    score: scoreEntry(entry, profile, archetype),
  }));

  // Sort by score desc, then by id asc for stable ordering
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.entry.id.localeCompare(b.entry.id);
  });

  return scored
    .filter((s) => s.score > 0)
    .slice(0, limit)
    .map((s) => s.entry);
}

/**
 * Return the top-N plugin recommendations as a short markdown section,
 * suitable for embedding in the setup recipe.
 */
export function buildPluginRecommendationsSection(
  profile: OperatorProfileSignal | null,
  archetype: ArchetypeSignal | null,
  topN = 3,
): string {
  const top = recommendPlugins(profile, archetype, topN);

  const lines: string[] = [
    "## Plugins relevant to your setup",
    "",
  ];

  if (top.length === 0) {
    lines.push(
      "No plugins matched the current operator profile + archetype signals.  Full catalog: `paperclip://plugins`.",
    );
  } else {
    for (const entry of top) {
      lines.push(`- **${entry.name}** (\`${entry.id}\`) — ${entry.description}`);
    }
    lines.push("");
    lines.push("Full catalog: `paperclip://plugins`.");
  }

  lines.push("");
  return lines.join("\n");
}
