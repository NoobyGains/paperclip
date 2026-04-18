/**
 * Layer 3 — Unified capabilities flag translator.
 *
 * Maps the hire-payload `hireCapabilities` object to the per-adapter
 * config keys and/or desiredSkills entries that actually enable those
 * capabilities at runtime.  Translation happens server-side before the
 * agent is persisted, so adapters keep their own config shapes and
 * callers never need to know per-adapter quirks.
 */

export interface HireCapabilities {
  webSearch?: boolean;
  browser?: boolean;
  terminal?: boolean;
  filesystem?: boolean;
}

export interface AppliedCapabilities {
  adapterConfig: Record<string, unknown>;
  desiredSkills: string[];
}

/** Skill slug used for all non-codex, non-hermes adapters until a real
 *  web-search skill ships (tracked as a follow-up issue). */
const WEB_SEARCH_SKILL = "paperclip-web-search";

/** Skill slug for agent-browser, shared across adapters. */
const AGENT_BROWSER_SKILL = "vercel-labs/agent-browser/agent-browser";

/**
 * Merge a toolset token into a hermes `toolsets` string.
 * Hermes uses comma-separated tokens like `"terminal,file,web"`.
 */
function mergeHermesToolset(
  existing: unknown,
  token: string,
): string {
  const base = typeof existing === "string" && existing.trim().length > 0
    ? existing.trim()
    : "";
  const parts = base ? base.split(",").map((s) => s.trim()) : [];
  if (!parts.includes(token)) parts.push(token);
  return parts.join(",");
}

/**
 * Add a skill slug to the list if it is not already present.
 */
function addSkill(skills: string[], slug: string): void {
  if (!skills.includes(slug)) skills.push(slug);
}

/**
 * Translate hire-payload capabilities into the concrete adapterConfig
 * keys and desiredSkills entries for a given adapter type.
 *
 * @param adapterType   The resolved adapter type (e.g. "codex_local").
 * @param adapterConfig The current adapter config (will be cloned, not mutated).
 * @param capabilities  The optional hire capabilities object.
 * @param desiredSkills The current desiredSkills array from the hire payload.
 * @returns A new `{ adapterConfig, desiredSkills }` with capabilities applied.
 */
export function applyCapabilitiesToHirePayload(
  adapterType: string,
  adapterConfig: Record<string, unknown>,
  capabilities: HireCapabilities | undefined,
  desiredSkills: string[] | undefined,
): AppliedCapabilities {
  const config: Record<string, unknown> = { ...adapterConfig };
  const skills: string[] = desiredSkills ? [...desiredSkills] : [];

  if (!capabilities) {
    return { adapterConfig: config, desiredSkills: skills };
  }

  switch (adapterType) {
    case "codex_local": {
      if (capabilities.webSearch) {
        config.search = true;
      }
      if (capabilities.browser) {
        config.search = true;
        addSkill(skills, AGENT_BROWSER_SKILL);
      }
      break;
    }

    case "claude_local": {
      if (capabilities.webSearch) {
        addSkill(skills, WEB_SEARCH_SKILL);
      }
      if (capabilities.browser) {
        addSkill(skills, WEB_SEARCH_SKILL);
        addSkill(skills, AGENT_BROWSER_SKILL);
      }
      break;
    }

    case "hermes_local": {
      if (capabilities.webSearch) {
        config.toolsets = mergeHermesToolset(config.toolsets, "web");
      }
      if (capabilities.browser) {
        config.toolsets = mergeHermesToolset(config.toolsets, "web");
        config.toolsets = mergeHermesToolset(config.toolsets, "browser");
      }
      break;
    }

    case "gemini_local":
    case "cursor":
    case "pi_local":
    case "opencode_local": {
      if (capabilities.webSearch || capabilities.browser) {
        addSkill(skills, WEB_SEARCH_SKILL);
      }
      if (capabilities.browser) {
        addSkill(skills, AGENT_BROWSER_SKILL);
      }
      break;
    }

    case "openclaw_gateway": {
      // Pass-through: the remote agent manages its own tool config.
      break;
    }

    default: {
      // Unknown adapter — inject web-search skill as a best-effort fallback.
      if (capabilities.webSearch || capabilities.browser) {
        addSkill(skills, WEB_SEARCH_SKILL);
      }
      if (capabilities.browser) {
        addSkill(skills, AGENT_BROWSER_SKILL);
      }
      break;
    }
  }

  return { adapterConfig: config, desiredSkills: skills };
}
