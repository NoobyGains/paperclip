# Roadmap — Self-teaching Paperclip

**Date:** 2026-04-18
**Initiative label:** `initiative:self-teaching-paperclip`
**Spec:** [`docs/superpowers/specs/2026-04-18-self-teaching-paperclip-design.md`](../superpowers/specs/2026-04-18-self-teaching-paperclip-design.md)
**Repo:** `NoobyGains/paperclip`
**Issue count:** 12 (F1–F3, P1–P4, R1, O1–O2, S1, PL1)

**2026-04-18 addendum:** **PL1 (#28) — plugin discovery + recommendations.** Added after the operator flagged the [awesome-paperclip](https://github.com/gsxdsm/awesome-paperclip) ecosystem. Sits in Phase 3 alongside O1/O2 (it wants F1 + F2 + P2 landed first). Adds ~1 day to the roadmap. See spec addendum and issue body for details.

## Phase overview

| Phase | Theme | Issues | Parallelism | Ships when |
|---|---|---|---|---|
| **0** | Foundation | F1, F2, F3 | 3-way parallel | All three merged to `master` |
| **1** | Policy & resources | P1, P2, P3, P4 | 3-way parallel after F1 (P3 independent) | All four merged |
| **2** | Registries | R1 | Single | After F2 merged |
| **3** | Onboarding | O1, O2 | 2-way parallel but O2 needs F1+F3+P1+R1 | O2 merged |
| **4** | Self-refinement | S1 | Single | After F3+O2 merged |

Estimated calendar at David's parallel-worker cadence (three agents in parallel per phase): ~4 weeks end-to-end.

## Dependency graph

```
                 ┌─────────────────┐
                 │ F1 operator     │
                 │    profile      │
                 └─┬─────┬─────┬───┘
                   │     │     │
    ┌──────────────┘     │     └──────────────┐
    ▼                    ▼                    ▼
┌──────────┐      ┌──────────┐      ┌──────────────┐
│ P1       │      │ P2       │      │ P4           │
│ subs-only│      │ recipe   │      │ explainable  │
│ enforce  │      │ resource │      │ descriptions │
└────┬─────┘      └──────────┘      └──────────────┘
     │
     │      ┌──────────────┐
     │      │ F2 archetype │──┐
     │      │  detection   │  │
     │      └────┬─────────┘  │
     │           │            │
     │           ▼            │
     │      ┌──────────┐      │
     │      │ R1 team  │      │
     │      │  shapes  │      │
     │      └────┬─────┘      │
     │           │            │
     │   ┌───────┘            │
     │   │                    │
     │   │    ┌────────────┐  │
     │   │    │ F3 CEO     │◄─┘ (overlay seed uses archetype)
     │   │    │  overlay   │
     │   │    └────┬───────┘
     │   │         │
     ▼   ▼         ▼
  ┌────────────────────┐      ┌──────────────────┐
  │ O2 onboard         │◄──── │ O1 auto-discovery │ (informs, not blocks)
  │   portfolio        │      └──────────────────┘
  └─────────┬──────────┘
            │
            ▼
     ┌───────────────┐
     │ S1 CEO self-  │
     │  refinement   │
     └───────────────┘

Independent (can ship anytime):
  P3 live-resource audit
```

**Critical path:** F1 → P1 → O2 → S1. Four issues in strict serial order; every other issue fans around this path.

## Per-phase detail

### Phase 0 — Foundation

Three issues, all parallelizable (no inter-dependencies within the phase).

| Issue | Subject | Suggested branch | Done when |
|---|---|---|---|
| F1 | Operator profile + `subscriptionOnly` flag | `fix/F1-operator-profile` | Migration applied; `paperclipGetMyProfile` + `paperclipUpdateMyProfile` round-trip green; unit tests pass |
| F2 | Project archetype detection service | `fix/F2-archetype-detection` | `paperclipDetectProjectArchetype` returns correct descriptors for fixtures (pnpm-monorepo, npm-single, python-poetry, rust-cargo, go-modules, unknown) |
| F3 | Per-project CEO overlay loader + writer | `fix/F3-ceo-overlay` | Migration applied (`projectId` on agents); `paperclipWriteCeoOverlay` writes `.paperclip/ceo/*`; CEO hire with a set `projectId` loads overlay over defaults; integration test green |

**Phase-0 ships when:** all three merged to `master`. Phase 1 starts unblocked.

### Phase 1 — Policy & resources

Four issues. P3 is fully independent and can ship anytime. P1, P2, P4 all need F1.

| Issue | Subject | Suggested branch | Done when |
|---|---|---|---|
| P1 | Adapter `billingMode` + subs-only enforcement | `fix/P1-subs-only` | Each adapter declares `billingMode`; server hire middleware refuses API-billed hires for `subscriptionOnly=true` profiles with structured error; MCP tool surfaces error cleanly |
| P2 | MCP `paperclip://setup/recipe` resource | `fix/P2-recipe-resource` | Resource read returns prose recipe customized to operator profile + filtered adapters; `/llms/setup-recipe.txt` mirrors |
| P3 | Live MCP resource audit | `fix/P3-live-resources` | Audit complete; convention doc committed; smoke test asserts mutation visible in next read |
| P4 | Explainable defaults in tool descriptions | `fix/P4-explainable-tools` | `listTools` output includes profile-derived text for at least 3 key tools; cached within session; falls back on profile fetch failure |

**Phase-1 ships when:** all four merged. Phase 3 unblocks.

### Phase 2 — Registries

One issue. Depends on F2.

| Issue | Subject | Suggested branch | Done when |
|---|---|---|---|
| R1 | Team-shape presets per archetype | `fix/R1-team-shapes` | Registry mapping for pnpm-monorepo, npm-single, python-poetry, rust-cargo, go-modules, unknown; `paperclip://archetypes` resource live; `paperclipGetTeamShape` round-trips |

**Phase-2 ships when:** R1 merged. Phase 3 unblocks.

### Phase 3 — Onboarding

Two issues. O1 is independent; O2 synthesizes F1 + F3 + P1 + R1.

| Issue | Subject | Suggested branch | Done when |
|---|---|---|---|
| O1 | Portfolio auto-discovery | `fix/O1-portfolio-discovery` | `paperclipDiscoverProjects` finds local `.git` dirs + GitHub repos, dedupes by remote; fixture tests green |
| O2 | Multi-project onboard tool | `fix/O2-onboard-portfolio` | `paperclipOnboardPortfolio([paperclip, endpoint-shield])` creates two companies, two CEOs, two reviewers, pre-hires per team shape, writes two `.paperclip/ceo/` overlays, is idempotent on re-run |

**Phase-3 ships when:** O2 merged. Phase 4 unblocks.

### Phase 4 — Self-refinement

One issue.

| Issue | Subject | Suggested branch | Done when |
|---|---|---|---|
| S1 | CEO self-refinement on first heartbeat | `fix/S1-ceo-self-refine` | `paperclipRefineCeoOverlay` writes updated overlay + `.paperclip/ceo/.history/` entry; CEO heartbeat step instructs the call; integration test with a fake CEO passes |

**Phase-4 ships when:** S1 merged. Initiative complete.

## End-to-end verification (post Phase 4)

The canonical success story, runnable from any fresh Claude session:

1. `paperclipUpdateMyProfile({ subscriptionOnly: true, claudeSubscription: "max", codexSubscription: "max" })`
2. Read `paperclip://setup/recipe` — see the recipe rendered for a Max-sub operator.
3. `paperclipDiscoverProjects({ rootPath: "C:/Users/David/Desktop/Projects" })` — candidates return.
4. `paperclipOnboardPortfolio({ projects: [ { repoPath: "…/paperclip" }, { repoPath: "…/endpoint-shield" } ] })`.
5. Confirm two companies exist; inspect `.paperclip/ceo/AGENTS.md` in both repos; each has project-specific content.
6. Attempt `paperclipCreateAgentHire({ adapterType: "<some-api-billed-adapter>" })` — refused with subscription-only structured error.
7. Invoke paperclip CEO heartbeat — on first run, it updates `.paperclip/ceo/AGENTS.md` with repo-specific detail; `.paperclip/ceo/.history/` captures prior.
8. `docs/runbooks/dogfood-paperclip-on-paperclip.md` can be shortened — steps 2/3/5 collapse into the single portfolio call.

## Parallelization guidance

When dispatching workers:

- **Phase 0 (3 workers):** F1 ≫ F2 ≫ F3 in three separate worktrees off `fork/master`.
- **Phase 1 (3 workers):** P1 ≫ P2 ≫ P4 in worktrees from the F1-merged master; P3 can run alongside or any time.
- **Phase 2 (1 worker):** R1 alone; could run alongside Phase 1 once F2 is in.
- **Phase 3 (1 worker + 1 optional):** O2 alone; O1 optionally parallel.
- **Phase 4 (1 worker):** S1 alone.

Peak parallel worker count: **4** (F1+F2+F3+P3) during the Phase 0 / Phase 1 overlap if P3 ships early.

## Branch naming and PR convention

- Each worker branch off `fork/master`: `fix/<issue-id>-<kebab-subject>` (e.g. `fix/F1-operator-profile`).
- PR title: `feat(initiative-self-teaching): <issue-id> — <summary>`.
- PR body references the spec + the issue.
- Merge direction: all branches → `fork/master` (continue current fork convention).

## Rollback posture

- **F1/F3 migrations** (0061, 0062) are additive: new table, new nullable column. Safe to leave in place if an issue is reverted; the unused schema is inert.
- **P1 enforcement** is gated by `subscriptionOnly` on the operator profile. If problematic, set `subscriptionOnly=false` on all profiles to neutralize.
- **F3 overlay** falls back to server defaults if the `.paperclip/ceo/` folder is missing or empty. Safe to delete the folder per-repo to revert.
- **S1 self-refinement** is auto-apply but history-preserving. Revert a bad write via git in the managed repo.

## Out-of-initiative follow-ons (tracked separately, not blocking this roadmap)

- **Skill bundles per archetype** — deferred. Will become its own spec + initiative.
- **Clipmart templates** — unchanged upstream roadmap.
- **Product-language UI rename** — independent UX spec.
- **Per-seat Max quota tracking** — not in backlog yet.
- **Budget-aware dynamic model downgrade** — not in backlog yet.
- **Codex-reported bugs** (company-portability partial-import, github-bridge permission bypass, eligibility check too permissive, instructions-bundle regression on error) — file as separate bug issues; orthogonal.
