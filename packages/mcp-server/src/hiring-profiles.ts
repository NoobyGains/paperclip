/**
 * Machine-readable version of the CEO's hiring playbook.
 *
 * Human-readable canonical source: server/src/onboarding-assets/ceo/HIRING_PLAYBOOK.md
 * Served over HTTP: /llms/hiring-playbook.txt
 * Served as MCP resource: paperclip://hiring-playbook
 *
 * When the server-side hire endpoint grows native `profile` support
 * (issue #14 L4 wiring), this registry should move to @paperclipai/shared
 * so both the server and the MCP read from the same source. For now it
 * lives here so the MCP's paperclipHireWithProfile tool can expand
 * profiles client-side without requiring server changes.
 */

export type HiringProfileId =
  | "coding-heavy"
  | "coding-standard"
  | "coding-light"
  | "reasoning-heavy"
  | "reasoning-standard"
  | "reviewer"
  | "research";

export interface HiringProfileAdapterConfig {
  model?: string;
  modelReasoningEffort?: "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  search?: boolean;
  fastMode?: boolean;
  [key: string]: unknown;
}

export interface HiringProfileDefinition {
  id: HiringProfileId;
  summary: string;
  adapterType: string;
  adapterConfig: HiringProfileAdapterConfig;
  capabilities: {
    webSearch?: boolean;
    browser?: boolean;
  };
}

export const HIRING_PROFILES: Record<HiringProfileId, HiringProfileDefinition> = {
  "coding-heavy": {
    id: "coding-heavy",
    summary:
      "codex_local, gpt-5.4, effort=high, web search on, Codex Fast mode. Hard coding work that needs web lookup.",
    adapterType: "codex_local",
    adapterConfig: {
      model: "gpt-5.4",
      modelReasoningEffort: "high",
      search: true,
      fastMode: true,
    },
    capabilities: { webSearch: true },
  },
  "coding-standard": {
    id: "coding-standard",
    summary:
      "codex_local, gpt-5.3-codex, effort=medium. Default for most engineering specialists.",
    adapterType: "codex_local",
    adapterConfig: {
      model: "gpt-5.3-codex",
      modelReasoningEffort: "medium",
    },
    capabilities: {},
  },
  "coding-light": {
    id: "coding-light",
    summary:
      "codex_local, gpt-5.3-codex, effort=low. Simple edits, docs, dependency bumps.",
    adapterType: "codex_local",
    adapterConfig: {
      model: "gpt-5.3-codex",
      modelReasoningEffort: "low",
    },
    capabilities: {},
  },
  "reasoning-heavy": {
    id: "reasoning-heavy",
    summary:
      "claude_local, Opus 4.7, effort=xhigh. Architecture, design, hard triage.",
    adapterType: "claude_local",
    adapterConfig: {
      model: "claude-opus-4-7",
      effort: "xhigh",
    },
    capabilities: {},
  },
  "reasoning-standard": {
    id: "reasoning-standard",
    summary:
      "claude_local, Sonnet 4.6, effort=medium. Everyday thinking work (PM, designer, QA).",
    adapterType: "claude_local",
    adapterConfig: {
      model: "claude-sonnet-4-6",
      effort: "medium",
    },
    capabilities: {},
  },
  reviewer: {
    id: "reviewer",
    summary:
      "claude_local, Opus 4.7, effort=high, web search on. Cross-adapter reviewer — set as company.defaultReviewerAgentId.",
    adapterType: "claude_local",
    adapterConfig: {
      model: "claude-opus-4-7",
      effort: "high",
    },
    capabilities: { webSearch: true },
  },
  research: {
    id: "research",
    summary:
      "claude_local, Opus 4.7, effort=max, web search + browser. Deep research, multi-step investigation.",
    adapterType: "claude_local",
    adapterConfig: {
      model: "claude-opus-4-7",
      effort: "max",
    },
    capabilities: { webSearch: true, browser: true },
  },
};

export function getHiringProfile(id: string): HiringProfileDefinition | null {
  return (HIRING_PROFILES as Record<string, HiringProfileDefinition>)[id] ?? null;
}

export function listHiringProfiles(): HiringProfileDefinition[] {
  return Object.values(HIRING_PROFILES);
}
