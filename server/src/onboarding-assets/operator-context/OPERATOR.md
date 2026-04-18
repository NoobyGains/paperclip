# Paperclip Operator Context Pack

This document is intended for an external Claude/Codex window connected to
Paperclip via the MCP server. Read it once when you connect. It explains the
data model, the important states, and the diagnostic fields you should check
when the board user says something like "why is X stuck?"

Dynamic sections (current adapters, enum values) are stitched in at request
time from the server's source of truth, so this document is always live.

## Orientation

Paperclip is a multi-agent runtime where AI agents (CEO, CTO, engineers, etc.)
execute work against a shared issue tracker. The board (human user) sets
strategy; the agents do the work. Your job as an operator is to help the board
see and steer this system.

Every feature is scoped to a **company** (the tenant boundary). A company
contains agents, projects, issues, routines, skills, and settings. If the
board has more than one company, most tools require an explicit `companyId`;
otherwise, your MCP config's `PAPERCLIP_COMPANY_ID` is used.

## Feature inventory

### Agents

Autonomous actors that execute work. Each agent has an identity (role, title,
reports-to chain) and a runtime (adapter, config, heartbeat schedule).

**Key diagnostic fields**
- `status` — see enum below
- `pauseReason` — why the agent is paused (`null`, `"manual"`, `"budget"`, `"system"`)
- `adapterType` — which runtime it runs on (see adapter list below)
- `lastHeartbeatAt` — last time the agent responded; stale values are the
  first signal that an agent has wedged
- `spentMonthlyCents` vs `budgetMonthlyCents` — budget headroom
- `reportsTo` — org-chart pointer; the CEO usually reports to no one

**Common stuck modes**
- Agent sits in `pending_approval` if its hire was gated and the board never
  resolved the approval.
- Agent paused by budget: `status: "paused"` + `pauseReason: "budget"`. Raise
  the budget or re-approve.
- Agent `status: "idle"` but `lastHeartbeatAt` very old: heartbeat scheduler
  hasn't picked it up; check runtimeConfig.heartbeat.enabled and the company
  pause state.

**Recovery tools**
- `paperclipDiagnoseAgent` — one-call summary including locked issues and
  recent failed runs.
- `paperclipGetCompanySettings` / `paperclipUpdateCompanySettings` — flip
  company pause state if everything is paused at the company level.

### Issues

Work units (tasks, bugs, features). Assigned to an agent or user. Issues have
a status, an optional execution lock while they run, and an optional review
policy.

**Lifecycle status** (typical path): `backlog` → `todo` → `in_progress` →
`in_review` → `done`. Alt states: `blocked`, `cancelled`.

**Key diagnostic fields**
- `status`
- `assigneeAgentId` or `assigneeUserId`
- `executionRunId` + `executionLockedAt` — a checkout lock held while an
  agent runs the issue. If the run referenced here is terminal or missing,
  the lock is stale and needs release.
- `executionPolicy` — optional review/approval gates (see below)
- `executionState` — which review/approval stage is pending, on whom
- `blockedByIssueIds` — dependency chain

**Common stuck modes**
- Stale execution lock: `executionRunId` set but the run is `failed`,
  `cancelled`, `succeeded`, or `timed_out`. Fix with
  `paperclipReleaseStaleExecutionLock`.
- Review/approval deadlock: `executionState.currentParticipant` points at a
  deleted or suspended agent/user. The issue will never advance. Board must
  reassign or drop the stage.
- Blocked-by never resolves: `blockedByIssueIds` points at an open dependency
  that's also stuck somewhere — walk the chain.

**Recovery tools**
- `paperclipDiagnoseIssue` — one-call diagnostic that flags stale locks,
  blockers, and suggests the next action.
- `paperclipReleaseStaleExecutionLock` — safe release; noops if lock is
  active.
- `paperclipForceReleaseExecutionLock` — board-only admin force-release.

### Heartbeat runs

An execution of an agent. A run is created when an agent is woken (timer,
wake-on-demand, webhook). It carries logs, resource usage, and a pointer
back to the issues it touched.

**Status enum** — see below.

**Key diagnostic fields**
- `status`
- `agentId`, `invocationSource`
- `startedAt`, `finishedAt`
- `error`, `errorCode`
- `usageJson` — tokens, cost

**Common stuck modes**
- Run stuck in `queued`: the adapter dispatcher is backed up or the adapter
  process is unhealthy.
- Orphaned run: the agent process exited without closing out its run. The
  `reapOrphanedRuns` background job eventually marks these terminal, but a
  run found in `running` with old `startedAt` and no recent log activity is
  likely orphaned.

### Approvals

Gated decisions (hire an agent, approve a budget increase, approve CEO
strategy, etc.). A pending approval blocks its requester until it resolves.

**States** — see enum below.

**Common stuck modes**
- Pending approval with no authorized decider: happens when the only board
  user is offline and the approval type requires a board decision.
- Revision-requested approval never resubmitted: the requesting agent may
  have died. Unblock via comment-and-resubmit on behalf of the agent, or
  reject and recreate.

### Execution policy (review / approval stages)

Per-issue structured gate. Turns on optional review and/or approval stages
that the assigned agent must clear before the issue can be marked `done`.
The runtime enforces these — the agent cannot bypass them.

**Shape** (stored on `issue.executionPolicy`):
- `mode`: `"normal"` or `"auto"`
- `commentRequired`: `true` (invariant: every run must leave a comment)
- `stages`: ordered list of `{type: "review" | "approval", participants}`

**State** (stored on `issue.executionState`):
- `status`: `idle` | `pending` | `changes_requested` | `completed`
- `currentParticipant`: who must act next
- `returnAssignee`: who gets it back after gates complete

**Common stuck modes**
- `currentParticipant` is an agent that's been archived or a user that's
  offline → board must reassign.
- Agent tried to transition without leaving a comment → runtime rejected the
  transition. Add the comment then retry.

### Company settings (board toggles)

Company-wide configuration. See the enum section below for the live list of
settings fields on this instance.

**Common stuck modes**
- `status: "paused"` company: every agent paused regardless of own pauseReason.
- `requireBoardApprovalForNewAgents: true` with no board user available: new
  agents stuck in `pending_approval`. Bypass for imports with the
  `allowNewAgents` flag, or flip the setting temporarily.
- `codexSandboxLoopbackEnabled: false` and the agent is a Codex agent trying
  to call back to the Paperclip API: expect adapter-side auth failures. Flip
  the toggle on for self-hosted paperclip deployments.

### Routines

Scheduled or webhook-triggered automations. A routine has one or more
triggers; each fire enqueues work against an assigned agent.

**Trigger kinds**: `schedule` (cron), `webhook` (HTTP POST with HMAC or
bearer), `api` (direct call).

**Concurrency and catch-up policies** — see enum lists below.

**Common stuck modes**
- Cron expression invalid → `nextRunAt` is null; nothing fires.
- `nextRunAt` in the past with recent uptime → scheduler wedged or the
  assigned agent is paused and `skip_if_active` is blocking.

### Skills library

Company-wide reusable context packs (markdown + optional files) that agents
consume on demand. Installed via the skill library; bound to agents by slug
on hire.

### Adapters

Pluggable runtimes. The live list on this instance is stitched in below.
Each adapter has its own setup requirements. For Codex / Claude local
adapters, instructions materialize from the company's managed bundle on
agent activation.

### Activity / audit log

Immutable ledger of system actions. Queryable per company. When diagnosing
"why did this happen", the activity log is usually the fastest first stop.

## Recommended operator workflow

1. When the board asks "anything stuck?", call
   `paperclipDiagnoseCompany`. It returns paused agents, stale-lock issues,
   overdue approvals, and overdue routines in one blob.
2. For a specific issue that's stuck, call `paperclipDiagnoseIssue`. The
   returned `suggestedAction` field points at the correct recovery tool.
3. For a specific agent that seems stuck, call `paperclipDiagnoseAgent`.
4. For state snapshots without diagnosis, read the MCP resources:
   `paperclip://company/summary`, `paperclip://stuck`, etc.
5. Always prefer the diagnose tools over raw issue/agent reads — they do the
   fan-out for you and flag pre-computed diagnostics.

## When to escalate to the board

- Auto-review is on but the designated reviewer is missing / inactive.
- Approval has been pending more than `approvalAgeWarnHours` (default 24h).
- Company-level pause or over-budget state.
- Any decision that requires new spend authorization.
