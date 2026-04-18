# Company-level adapter defaults and auto-review

**Date:** 2026-04-18
**Status:** Draft — pending implementation plan
**Scope:** NoobyGains/paperclip fork, branching from master `008f8c35`

## Summary

Add two board-controlled company-level automations:

1. **Default new-hire adapter.** The CEO uses whichever adapter the board designates (Codex, Claude, Gemini, etc.) when it hires new agents. Includes an optional "auto-by-monthly-usage" mode that picks the adapter with the most headroom against board-set monthly caps.
2. **Auto-review on issues.** Every new issue automatically gets a review stage assigned to a designated reviewer agent, with a cross-adapter auto-pick fallback when the designated reviewer isn't available.

Both features round-trip through company portability (export/import).

## Goals

- Board gets a single setting page to steer which adapter new CEO hires run on.
- Board can either fix a default adapter manually or let paperclip pick the one with more quota headroom this month.
- Board can turn on automatic review for every new issue without touching individual issues.
- Reuse existing review-stage enforcement — don't build a new review pipeline.

## Non-goals

- Querying third-party subscription quotas (Anthropic / OpenAI) via their APIs. Paperclip counts its own runs against board-defined caps.
- Per-role reviewer configuration (e.g., "reviewer X for CTO, reviewer Y for CMO"). One company-wide reviewer for now.
- Changing how review enforcement works. Reuse `IssueExecutionPolicy` review stages as-is.
- A UI for viewing running quota dashboards — only enough UI to configure caps and see current usage inline.

## Current state (what already exists)

- Agents have an `adapterType` field (`claude_local`, `codex_local`, `gemini_local`, `cursor`, `opencode_local`, `hermes_local`). Picked at creation time via `ui/src/pages/NewAgent.tsx` or the `paperclip-create-agent` skill.
- CEO agents spawn new hires via the `paperclip-create-agent` skill, which calls `POST /api/companies/:id/agent-hires` with an explicit `adapterType`. Today the CEO has no default to read from — it picks on its own.
- Issues already support `executionPolicy.stages` with `review` and `approval` stage types, enforced by the runtime. Participants are configured per-issue. There is no default that auto-attaches a review stage.
- Company portability already has the pattern for new boolean/string settings (e.g., `requireBoardApprovalForNewAgents`, `codexSandboxLoopbackEnabled`). New settings follow that pattern.

## Design

### New company settings (five fields)

Added to `packages/shared/src/types/company.ts` + `validators/company.ts`, mirrored in DB schema (`packages/db/src/schema/companies.ts`) via a new migration:

| Field | Type | Default | Purpose |
|---|---|---|---|
| `defaultHireAdapter` | `string \| null` | `null` | Adapter-type key used by CEO hires when no explicit adapter is passed. |
| `hireAdapterMode` | `'manual' \| 'auto_by_quota'` | `'manual'` | Controls how the server resolves the adapter when caller omits it. |
| `adapterMonthlyCaps` | `Record<string, number> \| null` | `null` | Per-adapter monthly run cap for `auto_by_quota` mode. Example: `{"claude_local": 5000, "codex_local": 3000}`. |
| `autoReviewEnabled` | `boolean` | `false` | When true, auto-attach a review stage on new issues. |
| `defaultReviewerAgentId` | `string \| null` | `null` | Designated reviewer agent. Falls back to auto-pick when null or unavailable. |

All five fields round-trip through `server/src/services/company-portability.ts` export and import, on both `new_company` and `existing_company` paths. Legacy manifests without these fields use the defaults above (back-compatible).

The five fields cover both features: the first three (`defaultHireAdapter`, `hireAdapterMode`, `adapterMonthlyCaps`) drive the hire path; the last two (`autoReviewEnabled`, `defaultReviewerAgentId`) drive auto-review.

### Hire path

`POST /api/companies/:id/agent-hires` already accepts an explicit `adapterType`. Change: `adapterType` becomes optional. When omitted, the server resolves it:

- **`hireAdapterMode = 'manual'`:** use `defaultHireAdapter`. If that's `null`, fail with a `400` and message `"no default hire adapter configured; set one in company settings or pass adapterType explicitly"`.
- **`hireAdapterMode = 'auto_by_quota'`:** call `getAdapterMonthlyUsage(companyId)`, compare against `adapterMonthlyCaps`. Pick the adapter with the highest `(cap - usage)`. Tie-break by preferring `defaultHireAdapter` if set, else alphabetical by adapter key. If no caps are configured for any enabled adapter, or every adapter is at or over its cap, fail with a clear error.

The `paperclip-create-agent` skill (`skills/paperclip-create-agent/SKILL.md`) is updated so the CEO's hire payload no longer requires `adapterType`, and the skill documents the two modes and when to override.

### Run counting for quota mode

Add `getAdapterMonthlyUsage(companyId: string): Promise<Record<string, number>>` — returns the count of heartbeat runs started this calendar month (UTC) grouped by agent adapter type, scoped to the company. Likely lives in `server/src/services/heartbeat.ts` (that's where run telemetry is tracked). Caches at most 60 seconds in-memory; quota picks are not latency-critical.

### Auto-review on issue creation

In the issue create handler (`server/src/routes/issues.ts` or the service it calls), after the issue object is validated but before persistence:

1. If `executionPolicy` was passed in the request (even an empty `stages: []`), skip auto-review entirely — caller intent wins.
2. Else, if `company.autoReviewEnabled` is true, resolve the reviewer:
   1. Try `defaultReviewerAgentId`: must be active (not archived/suspended), must not be the issue's assignee, must belong to the same company.
   2. Else auto-pick: list active agents in the company whose `adapterType` differs from the assignee's `adapterType`. Choose deterministically: prefer any agent with role `"reviewer"`; otherwise oldest-created agent.
   3. If no valid reviewer is found, fail loudly — the issue is rejected with message `"auto-review is on but no eligible reviewer is available; designate one in company settings or disable auto-review"`.
3. Seed `issue.executionPolicy` with:
   ```json
   {
     "mode": "normal",
     "commentRequired": true,
     "stages": [{ "type": "review", "approvalsNeeded": 1, "participants": [{ "type": "agent", "agentId": "<resolved>" }] }]
   }
   ```

### UI changes — `ui/src/pages/CompanySettings.tsx`

Add a new **Automation** section beneath the existing company toggles:

- **Hiring defaults**
  - Dropdown: "Default new-hire adapter" — options pulled from enabled company adapters
  - Radio group: "Manual" (default) / "Auto by monthly usage"
  - When "Auto" selected: render per-adapter number inputs for monthly caps (optional). Inline help: "Caps track runs started this month. Adapters without a cap are treated as having unlimited headroom."
- **Review defaults**
  - Checkbox: "Require review on all new issues"
  - Agent dropdown: "Designated reviewer" — same component style as `ReportsToPicker`
  - Inline help: "If no reviewer is designated or they're unavailable, paperclip auto-picks an agent whose adapter differs from the issue's assignee."

All five settings persist via `PATCH /api/companies/:id` (extend the existing PATCH endpoint to accept the new fields).

## Edge cases

1. **Designated reviewer archived or deleted:** auto-pick fallback kicks in. If that also fails, issue creation fails loudly.
2. **Only one active agent in the company:** auto-review cannot find a different-adapter reviewer. Fail loudly with clear message.
3. **Assignee equals designated reviewer:** skip the designated reviewer and fall through to auto-pick.
4. **Quota mode with no caps configured:** treat all caps as Infinity — picks adapter alphabetically as a deterministic default. Show a non-blocking warning in the settings UI.
5. **Timezone for monthly reset:** calendar-month UTC. No per-user TZ handling.
6. **Legacy company package (import):** missing fields use the defaults listed above. Import does not fail.
7. **Disabled adapter as `defaultHireAdapter`:** validated on settings save — cannot pick an adapter that isn't enabled for the company.
8. **Explicit `executionPolicy` on issue create:** always wins. Auto-review skipped even if the explicit policy has zero stages.

## Test plan

**Portability**
- Export a company with all five new fields set, round-trip through import into a new company.
- Round-trip into an existing company under both legacy (missing fields) and populated manifests.

**Hire path**
- Manual mode with `defaultHireAdapter` set → new hire uses that adapter when `adapterType` omitted.
- Manual mode with no default → 400 with the documented message.
- Auto mode with caps → picks the adapter with most headroom; tie-break matches spec.
- Auto mode with one adapter over cap → skipped.
- Auto mode with all adapters over cap → 400.
- Explicit `adapterType` always wins regardless of mode.

**Auto-review on issue create**
- Designated reviewer present and eligible → review stage attached.
- Designated reviewer archived → auto-pick different-adapter agent.
- Designated reviewer is the assignee → skip, auto-pick.
- Only one active agent → fail with documented message.
- Explicit `executionPolicy` in create request → auto-attach skipped.
- Auto-review off → no stage attached, caller's policy (if any) preserved.

**UI**
- Settings page save + reload round-trips all four values.
- Changing mode from manual to auto reveals the cap inputs.

## Implementation sketch (for the plan phase)

Rough order — actual ordering comes from the writing-plans pass:

1. DB migration + schema + types/validators for the five new fields.
2. Portability export/import wiring + portability tests.
3. `getAdapterMonthlyUsage` helper + tests.
4. Hire endpoint resolution logic + tests.
5. `paperclip-create-agent` skill update.
6. Issue create auto-review resolution + tests.
7. Company settings UI + PATCH endpoint field wiring.
8. End-to-end: settings → hire → issue with review, covered by an e2e test.

## Follow-ups (not in this spec)

- Per-role reviewer configuration.
- Real subscription-quota integration with Anthropic / OpenAI when their APIs expose it (today they don't cleanly).
- CLI `paperclip company usage` command to inspect current monthly usage.
- Cap alerts ("Claude is at 90% for the month") surfaced on the home dashboard.
- Review for adapter-free cases (e.g., routines) — out of scope here since those don't have a single assignee adapter.

## Open questions

None at time of writing. If the implementation pass surfaces product choices the spec doesn't cover, stop and re-engage on this doc before shipping.
