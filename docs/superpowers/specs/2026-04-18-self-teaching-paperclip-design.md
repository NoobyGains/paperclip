# Self-teaching Paperclip — design

**Date:** 2026-04-18
**Status:** Approved (open questions listed below; first-issue implementation resolves)
**Tracks:** GitHub initiative `initiative:self-teaching-paperclip` on NoobyGains/paperclip (12 issues — F1–F3, P1–P4, R1, O1–O2, S1, PL1).

**2026-04-18 addendum — amplifier 13:** After the initial spec committed, the operator flagged the [awesome-paperclip](https://github.com/gsxdsm/awesome-paperclip) plugin ecosystem as an input to self-teaching. A 13th amplifier — **plugin discovery + recommendations** — was added and tracked as issue **PL1 (#28)**. v1: seeded catalog + `paperclip://plugins` resource + `paperclipListPlugins` tool; integrates into the recipe resource (P2). Dependencies: F1 (operator profile), F2 (archetype), P2 (recipe). Ships alongside or after P2.
**Related specs:**
- `docs/superpowers/specs/2026-04-18-agent-intelligence-design.md` (issue #14 — the brain / hiring profiles / capabilities)
- `docs/superpowers/specs/2026-04-18-adapter-defaults-and-review-design.md` (issues #6/#7 — defaultHireAdapter + auto-review)
**Runbook touched:** `docs/runbooks/dogfood-paperclip-on-paperclip.md` (steps 2–5 collapse once this ships)
**Related plan file:** `~/.claude/plans/zazzy-jumping-naur.md`

## Problem

Board user, 2026-04-18:

> *"I boot up Paperclip, load all the MCP tools, I ask it to add all my projects in to it, it needs to know how to set these projects up in the best way. How can Claude know how to do this if it doesn't know the changes?"*

The board user is on Claude Max + Codex Max subscriptions (flat-rate, never API-billed). They are product-driven, not a developer, and their mental model is **"Paperclip manages the build of any software project in my portfolio."** They want a calling Claude (or any MCP client) to be able to onboard the user's full project portfolio correctly given *only* the user's subscription context — without the operator reciting the recipe, touching env vars, or running a sequence of six MCP tools by hand.

Today the MCP surface cannot do this. Four concrete gaps:

### Gap 1 — Paperclip doesn't know the operator

There is no persisted "I'm on subscriptions only" signal. `authUsers` (at `packages/db/src/schema/auth.ts`) is a basic Auth.js shape (`id`, `name`, `email`, `emailVerified`, `image`) with no free-form preferences column. The only operator-scoped persistence today is `userSidebarPreferences` and `companyUserSidebarPreferences` — and they store UI ordering, nothing about billing mode, subscription declarations, or hiring defaults. The `paperclipMe` MCP tool returns *agent* context (the calling agent's company + role + permissions) — it has no operator-profile concept at all.

Result: calling Claude has no way to ask Paperclip *"what billing mode is the operator in?"* before making hiring recommendations. It guesses, and often guesses wrong — the `paperclip-create-agent` skill's baked-in example payload used `o4-mini` for a long time, so CEOs copied it faithfully.

### Gap 2 — Paperclip doesn't advertise the recipe as a discoverable MCP surface

Issue #14 (the brain) shipped earlier today: hiring profiles (`coding-heavy`, `coding-standard`, `reviewer`, `research`, …), a `HIRING_PLAYBOOK.md` that lives in `server/src/onboarding-assets/ceo/`, an MCP resource `paperclip://hiring-playbook` that serves it, and a tool `paperclipHireWithProfile` that expands a profile into a full hire. What is **not** there: a top-level "here is how a calling Claude should onboard a portfolio end-to-end for a subscription-only operator" recipe. The knowledge lives distributed across the playbook, the adapter-defaults spec, `docs/runbooks/dogfood-paperclip-on-paperclip.md`, and the dormant `HIRING_PLAYBOOK.md` section on reviewers. Calling Claude has to stumble into it.

### Gap 3 — There is no multi-project onboard tool

`paperclipBootstrapApp` takes a single `repoPath` and produces one company + one CEO + one project. Per the just-filed issue #16, even the single-project bootstrap does not capture the full recipe (`defaultHireAdapter`, `autoReviewEnabled`, reviewer hire, default hiring profile). For a portfolio, the operator must serialize that broken single-project bootstrap by hand, once per repo.

### Gap 4 — Every CEO boots identical regardless of which project it manages

`server/src/services/default-agent-instructions.ts` bundles four files — `AGENTS.md`, `HEARTBEAT.md`, `SOUL.md`, `TOOLS.md` — from `server/src/onboarding-assets/ceo/`. At hire time (`server/src/routes/agents.ts:668` via `loadDefaultAgentInstructionsBundle`) those files are materialized verbatim into the agent's managed bundle at `$PAPERCLIP_HOME/instances/.../agents/<agentId>/instructions/`. **Every CEO — paperclip-managing CEO, endpoint-shield-managing CEO, a hypothetical game-studio CEO — gets byte-identical instructions.**

Those instructions say generic things like *"Read the repo's README. List the top-level directory structure."* They say nothing about *"this repo uses `pnpm` not `npm`"*, *"the architecture doc is at `doc/SPEC.md`"*, *"migrations run via `pnpm db:migrate`"*, *"don't touch `legacy/`"*. The CEO's first-contact heartbeat does try to compensate by reading the repo and writing a *"Codebase orientation"* issue — but (a) that's reactive, not proactive, (b) the orientation isn't written back into the CEO's own instruction files, (c) it has to be rediscovered on every fresh hire, and (d) the agent execution path does not read the managed repo at runtime beyond `cwd` — it reads from the pre-materialized bundle only.

### Consolidated

The MCP surface is not self-teaching. A fresh Claude session, handed the MCP tool list and told *"onboard my projects"*, cannot:

- Know the operator's billing posture.
- Read a single authoritative recipe for "how do I correctly set this up."
- Apply that recipe to a portfolio in one call.
- Write project-specific CEO instructions that make the resulting CEOs genuinely aware of the repos they manage.

This spec fixes all four gaps as one cohesive initiative — because (a) the recipe is useless without the operator-profile signal, (b) the onboard tool is useless without the overlay mechanism, (c) the overlay mechanism is useless without a way to describe archetypes, (d) archetype detection is useless without the onboard tool consuming it.

## Goals

1. Paperclip persists the **operator's profile** (subscription declaration + preferences) and exposes it via MCP.
2. Paperclip publishes a single **discoverable recipe resource** that a calling Claude reads to understand "how to correctly onboard a project for this operator."
3. A single MCP call — `paperclipOnboardPortfolio` — idempotently onboards any number of projects, applying the recipe per project.
4. Each managed repo gets a **`.paperclip/ceo/` overlay** containing project-specific CEO instructions, version-controlled with the repo, merged on top of the server defaults at hire time.
5. Subscription-only mode is a **hard invariant** — API-billed adapter hires are refused at the server, not just discouraged by documentation.
6. Every MCP tool's description **explains its defaults** in terms of the operator's profile, so the calling Claude can justify its choices back to the board user in plain language.
7. On first heartbeat, the CEO **self-refines its own overlay** from what it learned reading the repo, closing the loop.

## Non-goals (v1)

- **Per-project skill bundles.** The existing `desiredSkills` + capabilities translator from issue #14 is sufficient for now. A dedicated archetype-aware skill-bundle system is a separate follow-on spec.
- **Clipmart-style portfolio templates.** Downloadable pre-built "company templates" are a separate follow-on.
- **Product-language UI pass.** Renaming *heartbeat* → *check-in*, *hire* → *add team member*, etc., across the dashboard is a dedicated UX spec, not this one.
- **Per-seat Max quota tracking.** Paperclip will not try to count how many Claude Max seats the operator has spare. `subscriptionOnly` gates the *kind* of adapter, not the *count*.
- **Budget-aware model downgrade.** Dynamically switching Opus → Sonnet when a budget nears cap is explicitly deferred (already a non-goal of spec #14).
- **Remote-agent (`openclaw_gateway`) billing classification.** Remote agents self-manage billing; the enforcement here only covers adapters that run on the operator's machine.

## Key findings from exploration

### What already works (reuse)

- **`paperclip://hiring-playbook` MCP resource** (line 120 of `packages/mcp-server/src/resources.ts`) — serves `HIRING_PLAYBOOK.md` dynamically at read time. Precedent for the new recipe resource.
- **`createToolDefinitions(client)`** (at `packages/mcp-server/src/tools.ts`) already receives a client instance when building tool definitions. The refactor to render descriptions per-user is therefore additive, not structural.
- **Resource `read()` functions are already dynamic** — they execute at request time, not server-startup time. Amplifier 9 (live resources) is largely hardening/docs work, not a refactor.
- **`paperclipBootstrapApp` writes `.paperclip/project.yaml`** (at `packages/mcp-server/src/tools.ts` lines 1040–1058) — established the convention of writing repo-local Paperclip state. The `.paperclip/ceo/` overlay slots in beside it.
- **`loadDefaultAgentInstructionsBundle`** (at `server/src/services/default-agent-instructions.ts`) is the single call site for CEO MD files at hire time. The overlay merge lives here.
- **Issue #14's hiring profiles** already encode "coding-heavy → codex_local + gpt-5.4 + search", "reviewer → claude_local + Opus 4.7". The recipe resource assembles from them.
- **Adapter interfaces** in `packages/adapters/*/src/index.ts` already declare `type`, `label`, `models[]`, `agentConfigurationDoc`. Adding a `billingMode` field is a one-line addition per adapter.

### What's missing (build)

- No `userProfiles` table, no operator-level preferences beyond sidebar UI ordering.
- No `billingMode` field on adapter metadata. `packages/adapter-utils/src/billing.ts` infers biller from env vars, not adapter registry.
- No agent → project → repoPath resolver. Agents know `companyId`; projects know `workspaces[].cwd`; no direct link makes it impossible to answer *"what repo does this CEO manage?"* without heuristics.
- No dynamic MCP tool descriptions — descriptions are static strings baked in at compile time.
- No archetype detection service.
- No team-shape registry.
- No portfolio-discovery surface (local or GitHub).
- No multi-project onboard tool.
- No CEO self-refinement tool.

## Design — twelve amplifiers across five phases

Each amplifier below is one (or in one case two) GitHub issues. All are shippable independently where the dependency graph allows. See the **Shipping order** section for the full graph.

### Phase 0 — Foundation

These three are the load-bearing additions. Everything else layers on them.

#### Amplifier 1 (issue F1) — Operator profile

**Goal:** persist the operator's self-declared context (subscription declarations, preferences) and expose it via MCP.

**Shape:**
- New table `userProfiles` in `packages/db/src/schema/userProfiles.ts`:
  - `userId` (fk → `authUsers.id`, primary key — one profile per auth user)
  - `subscriptionOnly` (boolean, default `true`)
  - `claudeSubscription` (text, nullable — e.g. `"max"`, `"pro"`, `"api"`)
  - `codexSubscription` (text, nullable — e.g. `"max"`, `"plus"`, `"api"`)
  - `preferences` (jsonb, default `{}`) — free-form for extensibility
  - `createdAt`, `updatedAt` (timestamps)
- Migration: `packages/db/src/migrations/0061_user_profiles.sql` (next migration number).
- Service: `server/src/services/user-profiles.ts` with `getProfile(userId)` that returns a profile, creating one with defaults on first access.
- Routes: `GET /api/me/profile`, `PATCH /api/me/profile` on an authenticated board-user session.
- MCP tools: `paperclipGetMyProfile` (READ_ONLY), `paperclipUpdateMyProfile` (SAFE_WRITE).
- MCP resource: `paperclip://me/profile` for discoverability.

**Important default:** `subscriptionOnly: true` for any profile created by a new operator. New installs are safe by default; operators who explicitly need API billing toggle it off.

**Verification:** unit tests under `server/src/__tests__/user-profiles.test.ts`; MCP-tool tests under `packages/mcp-server/src/tools.test.ts`.

#### Amplifier 6 (issue F2) — Project archetype detection

**Goal:** read a repo and produce a structured archetype descriptor that downstream amplifiers consume.

**Shape:**
- New service: `server/src/services/project-archetype.ts` with `detectArchetype(repoPath)` returning:
  ```ts
  {
    stack: "pnpm-monorepo" | "npm-single" | "python-poetry" | "rust-cargo" | "go-modules" | "dotnet" | "unknown";
    packageManager?: "pnpm" | "npm" | "yarn" | "poetry" | "cargo" | "go" | "dotnet";
    testCommand?: string;      // e.g. "pnpm test"
    migrationCommand?: string; // e.g. "pnpm db:migrate"
    lintCommand?: string;
    buildCommand?: string;
    archDocPath?: string;      // e.g. "doc/SPEC.md"
    existingClaudeMd?: string; // absolute path if present
    existingAgentsMd?: string;
    workspaces?: string[];     // from pnpm-workspace.yaml or package.json.workspaces
  }
  ```
- Detection heuristics: presence of `pnpm-workspace.yaml`, `package.json` + `workspaces` key, `pyproject.toml`, `Cargo.toml`, `go.mod`, `.csproj`. Parse `scripts` from `package.json` to fill `testCommand`/`migrationCommand`/etc.
- Extensibility: each archetype is a small detector module; unknown repos return `{ stack: "unknown" }` plus whatever partials could be inferred.
- MCP tool: `paperclipDetectProjectArchetype({ repoPath })` → returns the descriptor.
- MCP resource: `paperclip://archetypes/detected/<encoded repoPath>` (optional, read-through cache).

**Verification:** fixture-based tests — seed `tests/fixtures/archetype/pnpm-monorepo/`, `.../rust-cargo/`, etc. and assert detected descriptors match expected.

#### Amplifier 4 + 12 (issue F3) — Per-project CEO overlay

**Goal:** every CEO hire reads project-specific overlay MD files from `<repoPath>/.paperclip/ceo/` and merges them on top of the server defaults. Overlay files are version-controlled with the repo (portability).

**Shape:**
- **Agent → project resolver.** Add `projectId` column (uuid, nullable) to the `agents` table. Migration: `packages/db/src/migrations/0062_agent_project.sql`. At hire time via `paperclipCreateAgentHire`, accept an optional `projectId` and set it. Bootstrap and onboard tools set it explicitly. The CEO resolves repo-path via `agent → project → workspaces[0].cwd`.
- **Overlay loader.** Extend `loadDefaultAgentInstructionsBundle(role, { projectRepoPath? })` in `server/src/services/default-agent-instructions.ts`. If `projectRepoPath` is set and `<projectRepoPath>/.paperclip/ceo/<file>` exists, use it. Else fall back to server default.
- **Merge semantics:** per-file **replace** (not section-level merge). Documented convention: overlay files are full replacements. This keeps behavior simple and predictable; operators who want to tweak one section copy the default and edit.
- **MCP writer.** New tool `paperclipWriteCeoOverlay({ projectId, files: { "AGENTS.md": "...", ... } })` (SAFE_WRITE) that writes the provided contents into `<repoPath>/.paperclip/ceo/` on the server machine. Creates the directory if missing.
- **Hire-time wiring.** `server/src/routes/agents.ts` line ~668 resolves `projectRepoPath` from the new `projectId` and passes it to the loader.
- **`.paperclip/ceo/.gitignore` NOT generated.** The convention is: commit the overlay. That's what gives it portability (amplifier 12).

**Verification:** extend `server/src/__tests__/agent-instructions-service.test.ts` — seed a fake project, write overlay files, hire a CEO, assert the materialized bundle contains overlay content.

### Phase 1 — Policy and resources

Four amplifiers. Three depend on F1; one is independent.

#### Amplifier 8 (issue P1) — Adapter `billingMode` + subs-only enforcement

**Goal:** refuse API-billed hires when `userProfile.subscriptionOnly=true`.

**Shape:**
- **Adapter metadata.** Add `billingMode: "subscription" | "api" | "hybrid"` to each adapter's `src/index.ts`:
  - `claude_local` → `subscription`
  - `codex_local` → `subscription`
  - `cursor_local` → `subscription`
  - `gemini_local` → `subscription`
  - `opencode_local` → `subscription`
  - `pi_local` → `subscription`
  - `openclaw_gateway` → `hybrid` (remote agent manages own billing, treated as not-blocked)
- Shared type: update `AdapterRegistryEntry` in `packages/shared/src/types/adapter.ts` to require `billingMode`.
- **Server enforcement middleware.** In `server/src/routes/agents.ts` hire path: before creating the agent, look up the acting user's profile via `getProfile(userId)`. If `subscriptionOnly=true` and the chosen adapter has `billingMode: "api"`, refuse with HTTP 403 and structured error: `{ code: "subscription_only_violation", adapter, allowed: [list of subscription-backed adapters] }`.
- **MCP error surfacing.** The MCP server's hire tools surface the error text cleanly: *"That hire would use API billing. You're on subscription-only mode — pick a Codex (Max) or Claude (Max) agent instead."*
- **Explicit opt-out path.** Operators who want API billing set `subscriptionOnly: false` via `paperclipUpdateMyProfile`. Not toggled by individual hire calls — explicit profile change, logged.

**Verification:** new test `server/src/__tests__/subscription-only-enforcement.test.ts` — seed profile with `subscriptionOnly: true`, attempt API-billed hire, assert 403.

#### Amplifier 2 (issue P2) — MCP recipe resource

**Goal:** expose a single MCP resource that tells a calling Claude *"given this operator's profile, here's the end-to-end recipe for onboarding a project."*

**Shape:**
- New MCP resource `paperclip://setup/recipe` in `packages/mcp-server/src/resources.ts`.
- Rendered at read time from: operator profile (via `paperclipGetMyProfile`), HIRING_PLAYBOOK.md, adapter registry (filtered by `billingMode` when `subscriptionOnly=true`), archetype registry (from R1 once it ships).
- Content structure (prose, markdown):
  1. *"You are onboarding projects for operator X."*
  2. Operator context: subscription declarations.
  3. Recommended adapter defaults (derived from profile).
  4. Recommended hiring profiles (from the playbook, filtered to subscription-backed).
  5. Reviewer pattern.
  6. Per-project overlay expectations.
  7. One-paragraph canonical recipe: *"For each project: call `paperclipOnboardPortfolio` with …"*
- Also accessible at `GET /llms/setup-recipe.txt` for non-MCP clients, mirroring the `/llms/hiring-playbook.txt` precedent.

**Verification:** MCP integration test — read `paperclip://setup/recipe`, assert it contains the operator's declared subs, the filtered adapter list, and the canonical recipe paragraph.

#### Amplifier 9 (issue P3) — Live MCP resource audit

**Goal:** verify every `paperclip://*` resource renders from live state, not stale static copies. Document the convention so new resources follow it.

**Shape (expected to be small):**
- Enumerate every resource in `packages/mcp-server/src/resources.ts`.
- For each, verify the `read()` function queries live data (not a module-scoped cached copy).
- Where a resource IS cached: either justify with a TTL-documented cache or fix.
- Add a short section to `packages/mcp-server/README.md` (or `packages/mcp-server/docs/resources.md` — new) documenting the "live rendering" convention for new resources.

**Verification:** existing resource tests in `packages/mcp-server/src/resources.test.ts` cover correctness; this issue adds a smoke test asserting a mutation is visible in the next read.

#### Amplifier 10 (issue P4) — Explainable defaults in tool descriptions

**Goal:** every MCP tool's description explains its defaults in terms of the operator's profile, so a calling Claude can justify its choices in plain English.

**Shape:**
- Refactor `createToolDefinitions(client)` in `packages/mcp-server/src/tools.ts` to render descriptions at **list-tools time**, pulling operator profile from the client.
- Descriptions become template strings with `${profile.subscriptionOnly ? ... : ...}`-style conditionals.
- Example — current static description for `paperclipHireWithProfile`:
  > *"Hire a new agent using a named profile."*
- After:
  > *"Hire a new agent using a named profile. You are on subscription-only mode — defaults to Codex Max for coding profiles and Claude Max for reviewer/research profiles. Use profile names: coding-heavy, coding-standard, coding-light, reasoning-heavy, reasoning-standard, reviewer, research."*
- Profile is fetched lazily on the first `listTools` call per session, cached for that session.
- Fallback: if profile fetch fails, use the static fallback string — never block `listTools`.

**Verification:** `packages/mcp-server/src/tools.test.ts` gains a test that asserts the description for `paperclipHireWithProfile` contains `"subscription-only mode"` when profile says so.

### Phase 2 — Registries

One amplifier. Depends on F2.

#### Amplifier 7 (issue R1) — Team-shape presets per archetype

**Goal:** for each detected archetype, publish a recommended team shape (which roles to pre-hire, on which hiring profiles).

**Shape:**
- New registry: `packages/shared/src/team-shapes.ts` exporting a map of archetype → team shape:
  ```ts
  {
    "pnpm-monorepo": {
      roles: [
        { role: "cto", profile: "reasoning-standard" },
        { role: "engineer", name: "Backend Engineer", profile: "coding-standard" },
        { role: "engineer", name: "Frontend Engineer", profile: "coding-standard" },
        { role: "qa", profile: "reasoning-standard" },
        { role: "reviewer", profile: "reviewer" },
      ],
    },
    "rust-cargo": {
      roles: [
        { role: "engineer", name: "Senior Engineer", profile: "coding-heavy" },
        { role: "reviewer", profile: "reviewer" },
      ],
    },
    "unknown": {
      roles: [
        { role: "engineer", profile: "coding-standard" },
        { role: "reviewer", profile: "reviewer" },
      ],
    },
    // ... more archetypes as they're added
  }
  ```
- MCP resource: `paperclip://archetypes` — lists all archetypes + their team shapes.
- MCP tool: `paperclipGetTeamShape({ archetype })` → returns the team shape.

**Verification:** unit tests under `packages/shared/src/__tests__/team-shapes.test.ts`.

### Phase 3 — Onboarding

Two amplifiers. O1 is independent; O2 converges everything.

#### Amplifier 5 (issue O1) — Portfolio auto-discovery

**Goal:** scan the operator's local workspace and GitHub for candidate projects.

**Shape:**
- New MCP tool `paperclipDiscoverProjects({ rootPath?: string, github?: { owner: string } })` (READ_ONLY).
- Local FS scan: one level deep under `rootPath` (default: parent dir of current working repo), looking for `.git/` directories. For each hit, read `package.json`/etc. for a project name, detect the git remote.
- GitHub scan (if `github.owner` is set and the server can reach the GitHub API): list repos for that owner — respect rate limits.
- Dedupe by git remote URL.
- Return structured candidates:
  ```ts
  {
    local: Array<{ name, repoPath, remote? }>;
    github: Array<{ name, owner, url, description? }>;
    dedupedTotal: number;
  }
  ```
- No filesystem or GitHub writes. Purely read-only.

**Verification:** fixture-based tests — seed `tests/fixtures/portfolio/` with fake repo dirs; assert scan finds them. GitHub scan mocked via `nock` or similar.

#### Amplifier 3 (issue O2) — Multi-project onboard tool

**Goal:** one MCP call that onboards the entire portfolio.

**Shape:**
- New MCP tool `paperclipOnboardPortfolio({ projects: Array<{ repoPath, name?, overrides? }>, operatorProfile? })` (SAFE_WRITE).
- For each project, idempotently:
  1. Detect archetype via F2.
  2. Look up team shape via R1.
  3. If no company exists for this repo yet, create one (`name = overrides.name || archetype-derived name`), set `autoHireEnabled=true`, `requireBoardApprovalForNewAgents=false`, `defaultHireAdapter=codex_local`, `autoReviewEnabled=true`.
  4. Hire the CEO (via `paperclipBootstrapApp` internals — extract the reusable bits).
  5. Set `projectId` on the CEO (new F3 column).
  6. Hire the reviewer (via `paperclipHireWithProfile({ profile: "reviewer", ... })`). Set `company.defaultReviewerAgentId`.
  7. Pre-hire team-shape roles (CTO, workers) per R1.
  8. Write per-project CEO overlay via F3's `paperclipWriteCeoOverlay` — seeded from archetype descriptor (e.g. an `AGENTS.md` section *"This project is a pnpm monorepo. Migrations run via `pnpm db:migrate`. Architecture doc: `doc/SPEC.md`."*).
  9. Write `.paperclip/project.yaml` (existing mechanism).
  10. Enforce P1 on every hire: if any would violate `subscriptionOnly`, refuse that one and continue with the rest, reporting a partial result.
- Return structured report per project: `{ status: "onboarded" | "skipped" | "partial", companyId, ceoId, reviewerId, preHiredAgentIds, overlayWritten: true, refusedHires: [...] }` plus aggregate summary.

**Verification:** integration test — spin up fresh DB, call `paperclipOnboardPortfolio` with two fixture repos, assert two companies, CEOs, overlays, and no `requireBoardApprovalForNewAgents` overrides.

### Phase 4 — Self-refinement

One amplifier. Depends on F3 + O2.

#### Amplifier 11 (issue S1) — CEO self-refinement on first heartbeat

**Goal:** after the CEO reads the repo on first heartbeat, it calls a tool that writes back improvements to its own overlay.

**Shape:**
- New MCP tool `paperclipRefineCeoOverlay({ agentId, proposedChanges: { "AGENTS.md"?: string, ... } })` (SAFE_WRITE).
- Behavior:
  1. Resolve agent → project → repoPath.
  2. For each file in `proposedChanges`, write it to `<repoPath>/.paperclip/ceo/<file>`.
  3. Also write the previous contents to `<repoPath>/.paperclip/ceo/.history/<timestamp>-<file>` for rollback.
- Update `server/src/onboarding-assets/ceo/HEARTBEAT.md` — add a new step to the first-contact heartbeat: *"After your initial codebase read, call `paperclipRefineCeoOverlay` to update your own AGENTS.md with what you learned. Be concrete — commands, paths, taboos."*
- Safety: the diff is committed implicitly by writing to the repo; if the CEO writes garbage, the operator reverts via git. No human approval gate in v1 (David's call: *"auto-apply but keep a history."*).

**Verification:** integration test — fake CEO calls the refine tool, assert file written and history entry exists.

## Decisions on open questions

1. **Operator profile storage — new table vs JSON on `authUsers`?** **New `userProfiles` table.** JSON on authUsers complicates the Auth.js integration. A dedicated table is clearer and mirrors the existing per-user-sidebar-prefs pattern.
2. **Overlay merge semantics — per-file replace vs section merge?** **Per-file replace.** Simpler mental model, no ambiguity about what wins, easy to reason about for the operator.
3. **Agent → project resolver — `projectId` column vs "company's primary project" convention?** **Add `projectId` column.** Explicit is safer than convention; supports a future where one company manages multiple projects.
4. **Self-refinement safety — human approval gate vs auto-apply?** **Auto-apply with a history folder.** Operators revert via git if they don't like what the CEO wrote. No human-in-the-loop gate in v1.
5. **`subscriptionOnly` default for new operators?** **`true`.** Safe default; operators who need API billing flip it explicitly.
6. **Does the recipe resource need a prose natural-language version or just structured?** **Prose.** Calling Claude reads prose naturally. A structured variant (`paperclip://setup/recipe.json`) is a future enhancement.
7. **Does `paperclipOnboardPortfolio` auto-discover if no projects are passed?** **No — v1 requires explicit `projects` list.** Discovery (O1) is a separate, explicit call. Callers compose.

## Shipping order + dependency graph

Five phases, eleven issues. Critical path: F1 → P1 → O2 → S1 (four serial, ~30% of total work). Everything else parallelizes.

```
Phase 0 (parallel):
  F1 (operator profile) ─┬─→ P1
                         ├─→ P2
                         └─→ P4
  F2 (archetype) ────────┬─→ R1
                         └─→ (feeds F3's overlay seeding)
  F3 (overlay)  ────────────→ O2 ─→ S1

Phase 1 (after F1):
  P1 (subs enforcement) ─→ O2
  P2 (recipe resource)
  P3 (live audit)            [independent]
  P4 (explainable)

Phase 2 (after F2):
  R1 (team shapes) ─→ O2

Phase 3:
  O1 (discovery)    [independent, informs O2]
  O2 (onboard) ──→ S1

Phase 4:
  S1 (self-refinement)
```

Issue-level `Blocks`/`Blocked by`:

| Issue | Blocks | Blocked by |
|---|---|---|
| F1 | P1, P2, P4 | — |
| F2 | R1, O2 (overlay seed) | — |
| F3 | O2, S1 | — |
| P1 | O2 | F1 |
| P2 | — | F1 |
| P3 | — | — |
| P4 | — | F1 |
| R1 | O2 | F2 |
| O1 | — | — |
| O2 | S1 | F1, F3, P1, R1 |
| S1 | — | F3, O2 |

## Verification narrative

When the initiative is done, this end-to-end flow works:

1. **Boot fresh Paperclip** (no existing companies, no profile).
2. **Load MCP** — tool descriptions on first `listTools` call include no profile-specific text (operator profile defaults applied on first read = subscription-only).
3. **Calling Claude reads `paperclip://setup/recipe`** — sees *"You are on subscription-only mode; default pattern is codex workers + Claude reviewer."*
4. **Calling Claude calls `paperclipDiscoverProjects({ rootPath: "C:/Users/David/Desktop/Projects" })`** — gets back candidates (paperclip, endpoint-shield, quorum, …).
5. **Calling Claude calls `paperclipOnboardPortfolio({ projects: [{repoPath: "C:/Users/David/Desktop/Projects/paperclip"}, {repoPath: "C:/Users/David/Desktop/Projects/endpoint-shield"}] })`**.
6. **Result:** two companies created, each with a CEO + reviewer + pre-hired workers per the archetype's team shape, each repo has a `.paperclip/ceo/` folder with overlay MDs committed, `defaultHireAdapter=codex_local` + `autoReviewEnabled=true` set, `projectId` wired on every agent.
7. **Invoke the paperclip CEO's heartbeat.** On first run, the CEO reads the repo, runs its orientation flow, calls `paperclipRefineCeoOverlay` with enriched content (e.g. *"migrations: `pnpm db:migrate`; tests: `pnpm test:run`; architecture doc: `doc/SPEC.md`"*). The overlay files are updated; `.paperclip/ceo/.history/` gains the previous versions.
8. **If the CEO tries to hire an API-billed worker** (e.g. an experimental adapter registered with `billingMode: "api"`), the hire is refused with the structured subscription-only error.
9. **The dogfood runbook** (`docs/runbooks/dogfood-paperclip-on-paperclip.md`) shrinks dramatically — steps 2, 3, and 5 collapse into *"run `paperclipOnboardPortfolio`."*

Unit + integration tests per issue. No new smoke-test infrastructure required.

## Files to modify (summary table)

| Issue | Files |
|---|---|
| F1 | `packages/db/src/schema/userProfiles.ts` (new), `packages/db/src/migrations/0061_user_profiles.sql` (new), `server/src/services/user-profiles.ts` (new), `server/src/routes/me.ts` (likely new), `packages/mcp-server/src/tools.ts`, `packages/mcp-server/src/resources.ts`, `packages/mcp-server/src/client.ts` (add profile helpers) |
| F2 | `server/src/services/project-archetype.ts` (new), `server/src/routes/project-archetype.ts` (new), `packages/mcp-server/src/tools.ts`, fixtures under `tests/fixtures/archetype/` |
| F3 | `packages/db/src/migrations/0062_agent_project.sql` (new), `packages/db/src/schema/agents.ts`, `server/src/services/default-agent-instructions.ts`, `server/src/routes/agents.ts` (hire path), `packages/mcp-server/src/tools.ts` (new `paperclipWriteCeoOverlay`), `packages/shared/src/types/agent.ts` |
| P1 | Each adapter's `src/index.ts` (`billingMode` field), `packages/shared/src/types/adapter.ts`, `server/src/routes/agents.ts` (enforcement middleware), `server/src/services/user-profiles.ts` (consumer) |
| P2 | `packages/mcp-server/src/resources.ts` (new recipe resource), `server/src/routes/llms.ts` (new `/llms/setup-recipe.txt`) |
| P3 | `packages/mcp-server/src/resources.ts` (audit), `packages/mcp-server/docs/resources.md` (new, convention doc) |
| P4 | `packages/mcp-server/src/tools.ts` (dynamic descriptions refactor), `packages/mcp-server/src/client.ts` (lazy-cache profile), test updates |
| R1 | `packages/shared/src/team-shapes.ts` (new), `packages/mcp-server/src/resources.ts` (new archetypes resource), `packages/mcp-server/src/tools.ts` (new `paperclipGetTeamShape`) |
| O1 | `server/src/services/portfolio-discovery.ts` (new), `server/src/routes/portfolio.ts` (new), `packages/mcp-server/src/tools.ts` (new `paperclipDiscoverProjects`) |
| O2 | `server/src/services/portfolio-onboard.ts` (new, orchestrator), `packages/mcp-server/src/tools.ts` (new `paperclipOnboardPortfolio`), reuses F1/F2/F3/P1/R1 services |
| S1 | `packages/mcp-server/src/tools.ts` (new `paperclipRefineCeoOverlay`), `server/src/onboarding-assets/ceo/HEARTBEAT.md` (instruction update) |

## Existing utilities to reuse

- `loadDefaultAgentInstructionsBundle` — overlay loader extends it.
- `materializeManagedBundle` in `server/src/routes/agents.ts:~668` — overlay merge point at hire time.
- `PaperclipApiClient` in `packages/mcp-server/src/client.ts` — add profile-helper methods.
- `createToolDefinitions(client)` in `packages/mcp-server/src/tools.ts` — refactor for dynamic descriptions.
- `paperclip://hiring-playbook` resource at `packages/mcp-server/src/resources.ts:120` — precedent for the recipe resource.
- Hiring profile registry at `packages/mcp-server/src/hiring-profiles.ts` — recipe assembles from this.
- Company portability tests at `server/src/__tests__/company-portability.test.ts` — precedent for overlay round-trip.
- `paperclipBootstrapApp` (at `packages/mcp-server/src/tools.ts:~970`) — extract the reusable bootstrap internals for O2 to call per project.
- `paperclipHireWithProfile` (at `packages/mcp-server/src/tools.ts`) — O2 calls it for reviewer + pre-hires.

## Risks and mitigations

- **Dynamic tool descriptions (P4) may violate an MCP client's assumptions** if the client caches `listTools` output aggressively. Mitigation: document the behavior; descriptions are rendered at `listTools` time, cached within a session, re-rendered on session reconnect.
- **Archetype detection (F2) may misclassify edge-case repos.** Mitigation: `{ stack: "unknown" }` is the graceful degrade path; operator can override via `paperclipOnboardPortfolio`'s `overrides` field.
- **CEO self-refinement (S1) could write garbage on a confused heartbeat.** Mitigation: `.paperclip/ceo/.history/` retains prior versions; operator reverts via git.
- **Migrations 0061 + 0062 touch hot tables.** Mitigation: both are additive (new table, new nullable column); safe under concurrent writes. Standard migration review.
- **Idempotency of `paperclipOnboardPortfolio`** — re-running on an already-onboarded project must not duplicate agents. Mitigation: the onboarder checks for an existing company + CEO per repo before creating; if present, it just ensures settings are correct and reports `status: "skipped"`.

## Out of scope (for clarity — not a v1 deliverable)

- Remote-agent billing classification (`openclaw_gateway`).
- Skill bundle registry per archetype (follow-on spec).
- Clipmart-style company templates.
- Product-language UI rename.
- Per-seat Max quota tracking.
- Budget-aware dynamic downgrade.
- Multi-user / multi-operator portfolios (profiles are single-operator for v1).

## Acceptance

This spec is complete when:

- [ ] All 11 GitHub issues exist on NoobyGains/paperclip with `initiative:self-teaching-paperclip` label and correct `Blocks`/`Blocked by` lines.
- [ ] The roadmap at `docs/roadmaps/2026-04-18-self-teaching-paperclip-roadmap.md` matches the shipping order above.
- [ ] A worker can pick up issue F1 and execute it against the writing-plans output without needing to re-read this entire spec — the F1 issue is self-contained.
