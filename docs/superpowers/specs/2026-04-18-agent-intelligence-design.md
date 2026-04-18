# Agent-intelligence layer — design

**Date:** 2026-04-18
**Status:** Approved (open questions answered with defaults below)
**Tracks:** GitHub issue NoobyGains/paperclip#14
**Related specs:** `docs/superpowers/specs/2026-04-18-adapter-defaults-and-review-design.md`
**Related plan file:** `~/.claude/plans/groovy-churning-ember.md`

## Problem

Board user (2026-04-18): *"when I ask it to add workers, can it work out the thinking of the worker please, atm is selecting old dumb models, im subscription user so it should be using GPT-5.4 or Claude Opus 4.7 / Sonnet… and it should allow them to search also"*

The CEO agent, when hiring a specialist, has no guidance on model selection, reasoning-effort tiers, or tool access. The `paperclip-create-agent` skill's example payload uses `o4-mini` — so CEOs faithfully copy it. Meanwhile Opus 4.7, Sonnet 4.6, GPT-5.4 (with Codex Fast mode), and per-adapter search flags all exist but are dark matter to the CEO.

This spec describes the "brain" — the intelligence layer that maps an incoming issue's complexity + domain to the right (adapter, model, effort, tools, budget) for the specialist the CEO hires.

## Goals

1. CEO picks an **agent profile** per hire, not raw `adapterType` + `model`.
2. Specialists run on modern models with appropriate reasoning effort.
3. Web search is enabled where it helps, via a single `capabilities.webSearch` flag per hire regardless of adapter.
4. Team leads can hire into their own team — authority cascades down `reportsTo`.
5. Operator-Claude (via MCP) can introspect the full adapter-config surface — `paperclip://adapters/:type/config-schema` returns structured schema, `paperclip://hiring-playbook` returns the profiles.

## Non-goals (v1)

- Subscription-tier detection / plan-based model gating. (Paperclip detects `api` vs `subscription` billing type today but doesn't gate model access. Separate issue.)
- Dynamic budget-aware model downgrade (auto-switch Opus → Sonnet when budget nearing cap). Separate issue.
- Company-level `allowedModels` / `maxTier` policy. Separate issue.
- Worker-to-team-lead escalation state machine. v1 is prompt-level only.
- Real Claude web-search skill. v1 ships a stub (see Layer 3).

## Key findings from exploration

### What already works (reuse)

- **`desiredSkills: string[]`** on agent hire materializes named skills into the runtime (`~/.claude/skills/`, `~/.codex/skills/`, etc.) via each adapter's `skills.ts`. Clean tool-injection vector.
- **Per-agent `budgetMonthlyCents`** with auto-pause when breached.
- **`GET /api/companies/:id/adapters/:type/models`** already returns a model list per adapter.
- **Codex exposes `search: true`** → runs the CLI with `--search` for web access. One line.
- **Hermes exposes `toolsets: "terminal,file,web"`** for selective tool enablement.
- **`canCreateAgents` per-agent permission** already gates hiring. Cascading authority is "just" about granting it.
- **Adapter model lists are current**: claude_local has Opus 4.7 first, codex_local has gpt-5.4, opencode_local has `variant: "max"` tier.

### What's missing (build)

- No normalized reasoning-tier vocabulary. Codex: `modelReasoningEffort` (5 tiers). Pi: `thinking` (6). OpenCode: `variant` (6 incl. `max`). Claude: `effort` (only 3 — missing `xhigh`/`max`). Hermes: not exposed.
- Model metadata is flat `{id, label}[]` — no `tier`, no `recommendedFor`, no cost hint.
- Web search inconsistent: codex `search`, hermes `toolsets`, others nothing explicit.
- No "agent profile" abstraction.
- CEO onboarding says nothing about model choice.
- MCP can't introspect adapter config.
- Hiring authority doesn't cascade — only CEO gets `canCreateAgents=true` by default.
- No per-company model policy.

## Design — seven layers, shippable in order

### Layer 1 — Shared reasoning-tier vocabulary

- `packages/shared/src/constants.ts`: add `REASONING_TIERS = ["minimal", "low", "medium", "high", "xhigh", "max"] as const`. Superset across adapters.
- Each adapter's existing field name stays (minimize churn) but consumes the shared enum in UI + skill docs.
- `claude_local`'s `effort` extends to include `xhigh`/`max`, mapping to Claude Code extended-thinking budgets. UI infrastructure exists at `packages/adapters/claude-local/src/ui/build-config.ts` (`thinkingEffort`).

### Layer 2 — Normalized model metadata

Extend each adapter's model entries from `{id, label}` to:

```ts
{
  id: string;
  label: string;
  tier: "mini" | "standard" | "thinking" | "fast";
  recommendedFor: Array<"simple" | "coding" | "reasoning" | "research" | "review">;
  contextWindow?: number;
  notes?: string;
}
```

- Declared in each adapter's `packages/adapters/<type>/src/index.ts`.
- `GET /api/companies/:id/adapters/:type/models` returns the richer shape. Server handler at `server/src/adapters/registry.ts` (`listAdapterModels`) already delegates to the adapter — change is entirely in adapter packages.
- UI reads `tier` + `recommendedFor` and labels the dropdown accordingly.

### Layer 3 — Unified capabilities flag

New optional field on hire payload (validator: `packages/shared/src/validators/agent.ts`):

```ts
capabilities: {
  webSearch?: boolean;
  browser?: boolean;
  terminal?: boolean;
  filesystem?: boolean;
};
```

Server-side translator (`packages/adapter-utils/src/server/capabilities.ts`, new) maps these per adapter:

| adapter | `webSearch: true` | `browser: true` |
|---|---|---|
| `codex_local` | `search: true` in adapterConfig | `search: true` + inject `vercel-labs/agent-browser` skill |
| `claude_local` | inject `paperclip-web-search` skill (stub — v1) | inject `paperclip-web-search` + `agent-browser` |
| `hermes_local` | `toolsets` includes `"web"` | `toolsets` includes `"web,browser"` |
| `gemini_local`, `cursor`, `pi_local`, `opencode_local` | inject web-search skill via `desiredSkills` | inject `agent-browser` skill |
| `openclaw_gateway` | ignored — remote agent manages its own |

Adapters keep their own config shapes. Translation happens server-side before persistence.

### Layer 4 — Agent profile presets

New artifact `server/src/onboarding-assets/ceo/HIRING_PLAYBOOK.md`:

- **coding-heavy** — codex_local, gpt-5.4, effort=high, webSearch=true, fastMode=true
- **coding-standard** — codex_local, gpt-5.3-codex, effort=medium, webSearch=false
- **coding-light** — codex_local, gpt-5.3-codex, effort=low, webSearch=false
- **reasoning-heavy** — claude_local, claude-opus-4-7, effort=xhigh
- **reasoning-standard** — claude_local, claude-sonnet-4-6, effort=medium
- **reviewer** — claude_local, claude-opus-4-7, effort=high, webSearch=true
- **research** — claude_local, claude-opus-4-7, effort=max, webSearch=true, browser=true

Plus registry + expander at `server/src/services/hiring-profiles.ts` (new). `paperclip-create-agent` skill accepts optional `profile` field. Server expands it into the full adapterConfig + capabilities. Raw overrides still accepted.

### Layer 5 — Hiring-authority cascade

1. `LEAD_ROLES = ["cto", "cmo", "cfo", "pm", "devops", "designer", "researcher"] as const` in shared constants. New hires whose role is in this set are auto-granted `permissions.canCreateAgents=true`.
2. Hire endpoint enforces `reportsTo`-chain containment: you can only hire into your own subtree.
3. Hire endpoint enforces budget inheritance: new hire's `budgetMonthlyCents` ≤ hiring agent's `budgetMonthlyCents - spentMonthlyCents`.
4. **(Prompt-level)** specialist AGENTS.md instructs: "If you receive work outside your capability, hand it back to your `reportsTo`. Do NOT skip up to the CEO — trust the chain."

### Layer 6 — MCP introspection

- **Resource** `paperclip://adapters` — enabled adapter list with capability matrix.
- **Resource** `paperclip://adapters/{type}/config-schema` — JSON-schema of that adapter's `adapterConfig`, generated from Zod via `zod-to-json-schema` (add dep if missing).
- **Resource** `paperclip://adapters/{type}/models` — Layer-2 enriched model list.
- **Resource** `paperclip://hiring-playbook` — Layer-4 profiles.
- **Tool** `paperclipHireWithProfile({ role, profile, reportsTo, capabilities? })` — minimal surface; expands server-side. Existing `paperclipCreateAgentHire` stays for raw-control cases.

All new resources + tools get `READ_ONLY` / `SAFE_WRITE` annotations per MCP best-practices (already adopted in commit `8a877274`).

### Layer 7 — CEO + skill updates

- `server/src/onboarding-assets/ceo/AGENTS.md` — add a **Hiring** section referencing the playbook. Instruct: always pick a profile; only override when you must.
- `skills/paperclip-create-agent/SKILL.md` — replace `o4-mini` example with `gpt-5.4`; document `profile` field; document `capabilities` field.
- `skills/paperclip-create-agent/references/api-reference.md` — update model examples to `claude-sonnet-4-6` / `claude-opus-4-7`.
- New `/llms/hiring-playbook.txt` route — serves playbook content to non-MCP clients.

## Decisions on the plan's open questions

1. **Worker-to-team-lead escalation:** specialists hand work **back to their `reportsTo`**, not up to the CEO. Simpler, trusts the chain, cleaner blame. (Per-session answer from the board user earlier: "if this is not possible yet, we need to stop" — which implied they trust the chain model.)
2. **Claude web search:** v1 ships the **stub `paperclip-web-search` skill** that leans on Claude Code's native tool-use. Real search integration (Brave/Kagi/etc.) is a separate future issue.
3. **Default profile when CEO doesn't specify one:** **fail loudly** if neither `profile` nor an explicit `adapterType` is provided. Keeps intent explicit. No silent default.

## Shipping order

L1 → L2 → L3 → L4 → L5 → L6 → L7.

- L1–L3 are additive, zero behavior change until L4 activates them.
- L4 flips CEO behavior.
- L5 enables team leads.
- L6 makes operator-Claude fluent.
- L7 closes the loop on discoverability.

Each layer is its own PR. Worker picks them up in order.

## Verification

1. Start paperclip; `paperclipBootstrapApp` a fresh company.
2. `paperclipUpdateCompanySettings({ defaultHireAdapter: "codex_local", autoReviewEnabled: true, defaultReviewerAgentId: "<CEO>" })`.
3. From operator-Claude: *"read paperclip://hiring-playbook and paperclip://adapters — what options do I have?"*
4. Create test issue: *"Audit our email template engine for XSS bugs. High-priority."*
5. Invoke CEO heartbeat.
6. Expected: CEO picks `coding-heavy`, hires Backend Engineer with `profile=coding-heavy`. Resulting agent has `adapterType=codex_local`, `model=gpt-5.4`, `modelReasoningEffort=high`, `search=true`, `fastMode=true`.
7. Verify via `GET /api/agents/<newId>/configuration`.
8. Verify review stage auto-attached with claude_local reviewer.
9. On specialist heartbeat: verify `--search` passed to Codex CLI.

Unit + integration tests per layer, pattern-matching `server/src/__tests__/` and `packages/mcp-server/src/*.test.ts`.

## Dependencies

Hard deps (must ship before or concurrent with this):

- #6 — `defaultHireAdapter` wiring
- #7 — auto-review on issue create
- #8 — portability round-trip for new settings
- #10 — CEO first-contact prompt (where the CEO first hires)

Soft deps (can run independently):

- #9 — UI toggles
- #11 — GitHub issue bridge
- #13 — claude_local heartbeat smoke test (without this, L4+ can't be validated end-to-end)

## Files to modify (summary table)

| Layer | Files |
|---|---|
| L1 | `packages/shared/src/constants.ts`, `packages/shared/src/index.ts`, each adapter's `src/index.ts` (dropdown consumer) |
| L2 | Each adapter's `src/index.ts` (model entries), `packages/shared/src/types/adapter.ts` |
| L3 | `packages/shared/src/{types,validators}/agent.ts`, `packages/adapter-utils/src/server/capabilities.ts` (new), each adapter's `src/server/execute.ts`, `server/src/routes/agents.ts` |
| L4 | `server/src/onboarding-assets/ceo/HIRING_PLAYBOOK.md` (new), `server/src/services/hiring-profiles.ts` (new), `packages/shared/src/validators/agent.ts`, `server/src/routes/agents.ts`, `skills/paperclip-create-agent/SKILL.md` |
| L5 | `server/src/routes/agents.ts`, `server/src/onboarding-assets/ceo/AGENTS.md`, `packages/shared/src/constants.ts` (`LEAD_ROLES`) |
| L6 | `packages/mcp-server/src/resources.ts`, `packages/mcp-server/src/tools.ts`, `server/src/routes/llms.ts`, add `zod-to-json-schema` dep if needed |
| L7 | `server/src/onboarding-assets/ceo/AGENTS.md`, `skills/paperclip-create-agent/SKILL.md`, `skills/paperclip-create-agent/references/api-reference.md` |

## Existing utilities to reuse

- `resolvePaperclipDesiredSkillNames()` in `packages/adapter-utils/src/server-utils.ts` — use in the capabilities translator to inject skills.
- `agentService(db)` list methods — used in hiring-authority enforcement.
- MCP tool annotation constants (`READ_ONLY`, `SAFE_WRITE`, etc.) in `packages/mcp-server/src/tools.ts` — new tools/resources apply them.
- Zod `.shape` introspection pattern already used by MCP; `zod-to-json-schema` adds user-facing serialization.
