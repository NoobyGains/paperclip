# Paperclip First-Run Guide

You are an external Claude or Codex window connected to a Paperclip server
via the MCP. The board user has asked you to help them set up Paperclip
for a specific project, or they've asked "how do I use this?" and you need
a canonical walkthrough.

Paperclip's onboarding assumes this order:

## 1. Confirm the server is reachable

Call `paperclipSetup`. It pings `/health`, validates your API key via
`/api/agents/me`, and compares the server's MCP manifest to what this
MCP package expects. The response includes a `status` field:

- `ready` — you're good. Continue.
- `needs_attention` — the response's `issues` array tells you what to fix.
  The most common problem is that `PAPERCLIP_API_KEY` is missing or
  expired. Point the user at `paperclip-mcp-server --setup <url>` to
  regenerate a key and write a fresh `.mcp.json`.

## 2. Choose one of two bootstrap paths

### 2a. Green-field app (most common)

If the user wants to drop a new app into Paperclip, call
`paperclipBootstrapApp({ name, repoPath })` with:

- `name` — short product name, e.g. "Todo App"
- `repoPath` — absolute path to the user's repo on disk

That one call:

1. Creates a new company named `"<name> workspace"`.
2. Sets `requireBoardApprovalForNewAgents=false` and `autoHireEnabled=true`
   so the CEO can hire specialists without asking the board for approval
   each time.
3. Directly creates a CEO agent on the configured adapter (defaults to
   `claude_local`).
4. Creates a project pointing at `repoPath`.
5. Writes `.paperclip/project.yaml` into the repo so future Claude Code
   sessions opened inside the repo can pick up the IDs automatically.

After it finishes, call `paperclipCreateIssue` with the user's first task
and let the CEO take over.

### 2b. Existing company

If the user already has a company (they'll say something like "we have a
team in Paperclip already"), use `paperclipListAgents` and
`paperclipListProjects` to orient yourself instead of bootstrapping.

## 3. Check health at any time

When the user asks "is anything stuck?" or "why hasn't X happened?", read
the `paperclip://stuck` resource first — it gives you paused agents,
stale-lock issues, overdue approvals, and overdue routines in one blob.
Then drill in with `paperclipDiagnoseIssue` or `paperclipDiagnoseAgent`
as needed.

For concept-level questions ("what's an execution policy?", "what does
autoHireEnabled do?"), read the `paperclip://docs/operator-guide`
resource — it's the Operator Context Pack with every Paperclip concept,
state, and common stuck mode.

## 4. What paperclip expects you to do on the user's behalf

- Triage vague asks before creating issues ("the app is slow" → ask which
  page, which operation, what's acceptable latency). A good issue has a
  clear definition of done.
- Assign issues to the CEO initially. The CEO will reassign or hire as
  needed if `autoHireEnabled` is on.
- When the user says "ship it", don't merge or push on their behalf
  without confirmation. Paperclip doesn't do git merges; your job is to
  drive the agents and report.

## 5. Things to avoid

- Don't call `paperclipForceReleaseExecutionLock` without confirming with
  the user first. That endpoint overrides an active run and can lose work.
- Don't flip company settings (especially `requireBoardApprovalForNewAgents`)
  without explaining the implication to the user. Turning it off means new
  hires ship without board review.
- Don't generate fake UUIDs. If a tool needs an ID you don't have, list
  the relevant resource (`paperclip://agents`, `paperclip://issues/open`)
  or call the appropriate list tool.
