# Rename Proposal — post-initiative

**Status:** Awaiting David's pick on the name. Everything else (new README, positioning copy) is ready to slot in once the name lands.

**Context:** After the `initiative:self-teaching-paperclip` shipped (issues #17-#28 closed 2026-04-18), the fork has diverged meaningfully from upstream `paperclipai/paperclip`. David asked for a new name + new README positioning the new product story around the self-teaching MCP surface + portfolio onboarding + subscription-first invariant.

## What the product is now

A layer on top of Paperclip that:

- **Teaches a calling Claude everything it needs** to onboard a user's full project portfolio from a single MCP-resource read — operator profile (`paperclip://me/profile`), recipe (`paperclip://setup/recipe`), archetypes (`paperclip://archetypes`), plugin catalog (`paperclip://plugins`), hiring playbook (`paperclip://hiring-playbook`).
- **Does portfolio onboarding in one call:** `paperclipOnboardPortfolio` — detects archetypes, picks team shapes, seeds per-project CEO overlays in each repo's `.paperclip/ceo/` folder, auto-hires the reviewer, applies sub-only defaults.
- **Refuses to burn API billing** when the operator declares subscription-only mode. Enforced server-side, not just documented.
- **Explains its own defaults** — tool descriptions dynamically reference the operator's profile, so the calling Claude can justify its choices in plain language.
- **Self-refines the CEO** after first-contact heartbeat, writing learned project-specific context back into `.paperclip/ceo/` with history preservation.

The product metaphor remains "you run the board; the software runs the company" — but the new name should signal *portfolio*, *self-teaching*, or *the human control plane for multiple autonomous teams*.

## Scope of this rename

**In scope:**
- New project name + tagline.
- New top-level `README.md` positioned around the new feature set.
- Update `doc/assets/header.png` caption / brand references in docs (if any).
- Update `package.json` repo + homepage URLs.
- Possibly rename the GitHub repo (`NoobyGains/paperclip` -> `NoobyGains/<new-name>`).

**Out of scope (not changing):**
- Internal package names (`@paperclipai/server`, `@paperclipai/shared`, etc.) — these stay.
- MCP tool prefix (`paperclipXxx`) — stays; the MCP tools are stable API for external clients.
- Database table names — stay.
- Existing documentation under `docs/superpowers/specs/` and `docs/roadmaps/` — historical, stays.

## Name candidates

Each listed with the three-question sniff test: does it *sound* like a product? Does it hint at *what the product does*? Is it *available* (package name, domain, unclaimed on GitHub for the obvious spellings)?

### 1. **Helm** ⭐ recommended

- **Sound:** one syllable, strong, memorable. Pairs well with "you're at the helm."
- **Hint:** steering — matches "you're the board, Paperclip is the company." Helm lets you steer the fleet of AI agents.
- **Available:** `helm` is claimed by the Kubernetes tool. Conflict. Variants like `helmworks`, `at-helm`, `helm-os` might fly. Cautious +.
- **Tagline draft:** *"Helm — the human control plane for AI-run companies. Steer your portfolio of autonomous teams from one dashboard."*

### 2. **Fleet**

- **Sound:** short, punchy, has energy.
- **Hint:** a fleet of agent teams working across your portfolio. Matches the portfolio-onboarding story perfectly.
- **Available:** `fleet` is used by JetBrains for their IDE. Brand conflict risk.
- **Tagline draft:** *"Fleet — run a portfolio of AI-staffed companies. One dashboard. One roster. Your call."*

### 3. **Foreman**

- **Sound:** two syllables, industrial, a bit old-school.
- **Hint:** a foreman runs a crew. Very on-the-nose for the product metaphor.
- **Available:** Foreman is already an open-source server-management tool. Conflict.
- **Tagline draft:** *"Foreman — the foreman for your AI workforce. Goal in, software out."*

### 4. **Constable**

- **Sound:** three syllables, more distinctive, slightly formal.
- **Hint:** oversight + authority. Matches the board-governance framing.
- **Available:** Constable.js exists but niche; low conflict.
- **Tagline draft:** *"Constable — you're the board. Constable is the company."*

### 5. **Primer**

- **Sound:** two syllables, soft, educational connotation.
- **Hint:** a primer teaches. Directly lifts the "self-teaching MCP" framing.
- **Available:** broad term; collision possible but variants (`primer-os`, `primer-hq`) are open.
- **Tagline draft:** *"Primer — the MCP surface that teaches any Claude or Codex your entire portfolio's setup from scratch."*

## David's pick (fill in)

**Choice:** _______________________

**Alternative:** if none of the above land, invent one — the slot is yours.

## Once the name is picked

I will:

1. Write a new top-level `README.md` using the chosen name + tagline + the 4 amplifier stories (operator profile / recipe / portfolio onboarding / CEO overlay) as the headline features. The original upstream README (copied into this fork) stays at `doc/UPSTREAM-README.md` for historical context.
2. Update `package.json` top-level `name` / `repository` / `homepage` fields. Keep internal `@paperclipai/*` package names untouched (out of scope).
3. Draft the text for renaming the GitHub repo from `NoobyGains/paperclip` -> `NoobyGains/<chosen-name>` — David executes the actual rename via GitHub settings (it's destructive and irreversible without manual GH intervention).
4. Add a one-paragraph note to `user_profile.md` memory noting the rename happened so future sessions don't get confused.

Nothing else changes without explicit opt-in from David.

## New README — draft skeleton (fill in name)

```md
# <Name>

> <Tagline>

<Name> is the human control plane for AI-run software companies. Point it at your project portfolio and it sets up a full team per repo — CEO, reviewer, engineers — all wired to your Claude Max and Codex Max subscriptions. One call. No API billing. No recipe-reciting to the AI.

## What it does

- **One-call portfolio onboarding.** `paperclipOnboardPortfolio([repoA, repoB, ...])` detects each repo's archetype, picks the right team shape, hires the right agents on the right models, writes a project-specific overlay into `.paperclip/ceo/` so every CEO starts already knowing the repo.
- **Self-teaching MCP.** The MCP surface is enough for a fresh Claude session to onboard your whole portfolio correctly without you reciting the recipe — `paperclip://me/profile`, `paperclip://setup/recipe`, `paperclip://archetypes`, `paperclip://plugins`.
- **Subscription-first.** Declare `subscriptionOnly: true` once; any attempt to hire an API-billed agent is refused server-side with a clear error. You never accidentally burn credits.
- **Explainable defaults.** Every MCP tool's description says *why* it defaults the way it does, referencing your profile. Calling Claude can justify its choices to you in plain English.
- **CEO self-refinement.** After its first heartbeat, each CEO updates its own `.paperclip/ceo/` overlay with what it learned about the repo — and keeps a history folder for rollback.

## Quickstart

1. Install <Name> (TBD install flow — `npx <name> onboard` or similar).
2. Set your profile once: `paperclipUpdateMyProfile({ subscriptionOnly: true, claudeSubscription: "max", codexSubscription: "max" })`.
3. Point it at your projects: `paperclipOnboardPortfolio({ projects: [{ repoPath: "C:/path/to/project1" }, { repoPath: "C:/path/to/project2" }] })`.
4. Watch the dashboard at `http://localhost:5173`.

## Plugins

<Name> is aware of the [awesome-paperclip](https://github.com/gsxdsm/awesome-paperclip) plugin ecosystem. Read `paperclip://plugins` or `paperclip://plugins/recommended` from any MCP client to get tailored recommendations for your setup.

## Differences from upstream Paperclip

<Name> is a hard fork of [paperclipai/paperclip](https://github.com/paperclipai/paperclip). The upstream is excellent and handles the "one company, one CEO, one project" case very well. This fork adds:

- Operator profile + subs-only enforcement (won't ship in upstream — out of scope).
- Self-teaching MCP surface (recipe resource, explainable defaults, plugin awareness).
- One-call portfolio onboarding across multiple projects.
- Per-project CEO overlay via `.paperclip/ceo/` version-controlled with each repo.
- CEO self-refinement on first heartbeat.

All internal package names (`@paperclipai/*`) and MCP tool names (`paperclipXxx`) stay the same — this fork is a drop-in MCP client replacement for anyone already using Paperclip.
```
