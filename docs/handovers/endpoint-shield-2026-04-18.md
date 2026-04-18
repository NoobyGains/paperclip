# Endpoint Shield — Paperclip handover (2026-04-18)

**Status:** Paused. Resumes once the adapter-defaults + review-defaults + CEO-onboarding work is shipped (NoobyGains/paperclip issues #6–#13).

## Why this is paused

David wants paperclip to work like this:

1. He drops an app (Endpoint Shield) into paperclip.
2. The CEO agent **reads the codebase** to understand the project.
3. The CEO **imports open GitHub issues** as paperclip tasks.
4. The CEO **auto-hires Codex specialists** to work them (no adapter has to be picked manually).
5. A designated **Claude reviewer** is auto-attached to each new issue.
6. Work flows. He watches.

Today's session built the scaffolding and validated most of the pieces, but the *auto-hire-codex / auto-review-claude* defaults aren't fully wired yet, so we paused Endpoint setup rather than fake it by doing the CEO's work manually.

## What's live right now

- **Paperclip dev server**: running at `http://localhost:3100`. Postgres is embedded (paperclip-managed), data at `~/.paperclip/instances/default/db`.
- **Paperclip UI**: http://localhost:5173 (Vite dev server).
- **Company**: "Endpoint Shield workspace"
  - `companyId`: `06e2ee5c-75f4-434a-8735-9483fff89a90`
  - `autoHireEnabled`: true
  - `requireBoardApprovalForNewAgents`: false
  - `codexSandboxLoopbackEnabled`: true
  - `defaultHireAdapter`: **null** (needs #6)
  - `defaultReviewerAgentId`: **null** (needs #7)
  - `autoReviewEnabled`: **false** (needs #7)
- **Agents in that company**:
  - `CEO` (claude_local) — `55acca04-54f0-4f67-ba15-7bea2e48a07e`
  - `Backend Engineer` (codex_local) — `bc2f70fd-b95e-472f-83a0-9e6ff299d1d8` — created manually as a shortcut; probably needs to be re-hired by the CEO when we resume
  - `Frontend Engineer` (codex_local) — `c8a6e978-1493-4903-b539-c47a2a6a8f54` — same
  - `Compliance QA` (codex_local) — `cbbb3e32-2a45-4535-9e8c-cdd26aa8caf2` — same
- **Project**: "Endpoint Shield"
  - `projectId`: `aa271ba6-6a0f-4a88-8a7a-5ac8da780ecd`
  - `workspaceId`: `79586c20-ce22-4221-af17-90e6d0c37963`
  - Workspace `cwd`: `C:/Users/David/Desktop/Projects/Endpoint/Endpoint-Shield`
- **Long-lived API key** (scoped to CEO): `pcp_f63f62c8313f4e54b617aecd86036599f40e2f70dc57e473`
- **Endpoint-Shield repo** at `C:/Users/David/Desktop/Projects/Endpoint/Endpoint-Shield/`:
  - Synced to GitHub main as of this handover.
  - Contains `.paperclip/project.yaml` (paperclip project pointer — companyId, projectId, ceoAgentId, paperclipApiUrl).
  - Contains `.mcp.json` with the paperclip MCP configured and pre-filled with the API key.

## What was validated end-to-end

- Migration 0059 (`autoHireEnabled`) applied cleanly.
- `/api/mcp/manifest` returns the expected 14 feature keys.
- `/llms/operator-context.txt` serves the Operator Context Pack.
- Company create → settings PATCH → agent hire → project create → `.paperclip/project.yaml` write — the full `paperclipBootstrapApp` flow, proven via curl against the running server.
- Local-trusted mode accepts board-level requests without an API key; agent-scoped endpoints still require a real key.

## What was NOT validated (still pending)

- **Claude CLI actually runs under the CEO's heartbeat**. Issue #13 tracks this.
- **GitHub issues automatically imported into paperclip**. Issue #11 tracks the bridge.
- **CEO's first-contact behavior** (read codebase, import GH issues, hire team). Issue #10 tracks the prompt update.
- **Auto-hired specialists run their assigned issues through to completion**. Blocked on #13.

## The exact moment we stopped

I (Claude, via the user's session) had just hired 3 codex specialists *directly* under the CEO. The user correctly called it out — that's the board shortcut, not the CEO doing it. The right flow is: create one task for the CEO ("onboard this repo, hire your team, delegate the GH issues"), invoke the CEO's heartbeat, let the CEO do the hiring via the `paperclip-create-agent` skill.

But that only works cleanly once `defaultHireAdapter` is wired (so the CEO doesn't have to pick `codex_local` in each hire call) and auto-review is wired (so the CEO doesn't have to assign reviewers). Hence the pause.

## How to resume

1. **Ship issues #6–#13** on NoobyGains/paperclip. Rough order: #6 → #7 → #8 → #10 → #13 → #11 → #9 → #12.
2. **Clean up the existing Endpoint Shield company** if the shortcut-hired specialists are stale: terminate them (`POST /api/agents/:id/terminate`) or just repurpose them. Running paperclip will need to be restarted after #6–#7 are merged so the 0060 migration applies.
3. **Configure the company defaults** on Endpoint Shield via `PATCH /api/companies/06e2ee5c-75f4-434a-8735-9483fff89a90`:
   ```json
   {
     "defaultHireAdapter": "codex_local",
     "autoReviewEnabled": true,
     "defaultReviewerAgentId": "55acca04-54f0-4f67-ba15-7bea2e48a07e"
   }
   ```
   (Using the CEO as the reviewer is acceptable for v1 — it's claude_local, which is what David wants reviewers to be. #9's UI will make this easier.)
4. **Create a single bootstrap issue for the CEO**:
   - title: `Onboard Endpoint Shield`
   - description: `Read the repo at C:/Users/David/Desktop/Projects/Endpoint/Endpoint-Shield/. Then import open GitHub issues via \`gh issue list --repo NoobyGains/Endpoint-Shield --state open --limit 100\`. Then hire the Codex specialists you need to cover the incoming work. Reassign each imported issue to the right specialist.`
   - assignee: CEO agent (`55acca04-...`)
5. **Invoke CEO heartbeat**: `POST /api/agents/55acca04-54f0-4f67-ba15-7bea2e48a07e/heartbeat/invoke`.
6. **Watch** via `paperclip://stuck`, `paperclipDiagnoseCompany`, or the UI.
7. **Report success/failure**. If the CEO heartbeat spawns Claude successfully and the CEO actually does the work, the product vision is proven. If not, drill into #13.

## Useful references

- Design spec: `docs/superpowers/specs/2026-04-18-adapter-defaults-and-review-design.md`
- Implementation plan: `~/.claude/plans/groovy-churning-ember.md`
- Scaffolding commit (0060 migration + types): `ce3604fc`
- MCP bootstrap-app tool: `packages/mcp-server/src/tools.ts` → `paperclipBootstrapApp`
