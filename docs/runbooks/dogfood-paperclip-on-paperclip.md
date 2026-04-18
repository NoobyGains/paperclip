# Dogfood: Run Paperclip on Paperclip

This runbook walks you through bootstrapping a "Paperclip" company **inside your own running Paperclip**, pointed at the paperclip repo itself. The CEO will auto-import GitHub issues and hire specialists to work on them.

---

## Prerequisites

Before you start, confirm all of the following:

- **Paperclip is running locally.** Open `http://localhost:5173` — you should see the dashboard.
- **`claude` CLI is installed and logged in.** In your terminal: `claude --version`. If it fails, install it first.
- **`gh` CLI is authenticated.** In your terminal: `gh auth status`. It should show your GitHub account and access to `NoobyGains/paperclip`.
- **The paperclip repo is checked out on your machine.** You need the absolute path to that folder (e.g. `C:\Users\David\Desktop\Projects\paperclip` on Windows or `/home/david/projects/paperclip` on Mac/Linux).
- **MCP is configured in Claude Code with a board-level API key.** Your `.mcp.json` (or Claude Code MCP settings) should include `@paperclipai/mcp-server` with:
  - `PAPERCLIP_API_URL` = `http://localhost:3100`
  - `PAPERCLIP_API_KEY` = your board-level API key
  - `PAPERCLIP_COMPANY_ID` = leave blank for now (you will fill it in during step 2)

> **Important — worktree isolation:** The CEO will have write access to the repo. To prevent changes from crashing your running server, consider running the CEO in an isolated git worktree. See the note at the end of this file.

---

## Step 1 — Bootstrap the company

In your Claude Code session (with the MCP tools available), call:

```
paperclipBootstrapApp({
  name: "Paperclip",
  repoPath: "<absolute path to the paperclip repo>"
})
```

Replace `<absolute path to the paperclip repo>` with the actual path on your machine.

**What this does:**
- Creates a company named "Paperclip workspace"
- Sets `autoHireEnabled = true` and `requireBoardApprovalForNewAgents = false`
- Hires a CEO agent on `claude_local` pointed at the repo
- Creates a "Paperclip" project linked to the repo
- Writes `.paperclip/project.yaml` to the repo root

**Expected response shape:**

```json
{
  "company": { "id": "...", "name": "Paperclip workspace" },
  "ceoAgent": { "id": "...", "name": "CEO" },
  "project": { "id": "...", "name": "Paperclip" }
}
```

**Verify before moving on:**
- Copy the `company.id` and `ceoAgent.id` from the response — you will need them in every step below.
- Open `http://localhost:5173`. The "Paperclip workspace" company should appear in the company switcher.

**If it fails:**
- `422 Validation error` — check that `repoPath` is an absolute path and the directory exists.
- `401 Unauthorized` — your API key is not board-level. Regenerate it in Paperclip settings.

> **[blocked: pending #6 commit]** `paperclipBootstrapApp` is not yet in the committed MCP tool surface as of master. Until #6 ships, create the company manually: go to the UI, click "New Company", fill in "Paperclip workspace", then use `paperclipApiRequest` to create the CEO agent and project (see the API reference for shapes).

---

## Step 2 — Configure company defaults

Call:

```
paperclipUpdateCompanySettings({
  companyId: "<company.id from step 1>",
  defaultHireAdapter: "codex_local",
  autoReviewEnabled: true,
  defaultReviewerAgentId: "<ceoAgent.id from step 1>"
})
```

This tells Paperclip to:
- Hire all future specialists using the `codex_local` adapter (faster for coding tasks)
- Automatically route completed work through a review stage
- Use the CEO as the default reviewer until a dedicated reviewer is hired

**Expected response:** the updated company object with your new settings reflected.

**Verify before moving on:**
- Call `paperclipApiRequest({ method: "GET", path: "/api/companies/<companyId>" })` and confirm `defaultHireAdapter`, `autoReviewEnabled`, and `defaultReviewerAgentId` match what you set.

**If it fails:**
- `404` — wrong company ID. Re-copy from step 1.

> **[blocked: pending #6 and #7 commits]** `paperclipUpdateCompanySettings` depends on these fields being wired server-side. Until those ship, use `paperclipApiRequest({ method: "PATCH", path: "/api/companies/<id>", jsonBody: "{ ... }" })` directly.

---

## Step 3 — Hire a reviewer

Call:

```
paperclipHireWithProfile({
  companyId: "<company.id>",
  role: "reviewer",
  profile: "reviewer"
})
```

**Expected response:** a new agent object with `role: "reviewer"` and `adapterType: "claude_local"`.

Copy the reviewer agent's `id`.

Then set this agent as the default reviewer (replacing the CEO):

```
paperclipUpdateCompanySettings({
  companyId: "<company.id>",
  defaultReviewerAgentId: "<reviewer agent id>"
})
```

**Verify before moving on:**
- Call `paperclipListAgents({ companyId: "<company.id>" })` and confirm you see both the CEO and the reviewer.

**If it fails:**
- If `paperclipHireWithProfile` is not available, hire manually: `paperclipApiRequest({ method: "POST", path: "/api/companies/<id>/agents", jsonBody: "{ \"name\": \"Reviewer\", \"role\": \"reviewer\", \"adapterType\": \"claude_local\", \"reportsTo\": \"<ceoAgentId>\" }" })`

> **[blocked: pending #6 commit]** `paperclipHireWithProfile` is not yet in the committed tool surface. Use `paperclipApiRequest` to create the agent directly as shown above.

---

## Step 4 — Import GitHub issues

### Option A — GH bridge sync (preferred once #11 is committed)

> **[blocked: pending #11 commit]** This endpoint does not exist on master yet.

Once #11 ships:

```
paperclipApiRequest({
  method: "POST",
  path: "/api/projects/<project.id>/github-issues/sync"
})
```

**Expected response:**

```json
{ "imported": 42, "skipped": 0, "errors": [] }
```

**Verify:** Call `paperclipListIssues({ companyId: "<company.id>" })` and confirm issues appear with `originKind: "github_issue"`.

### Option B — CEO heartbeat (works now, exercises more of the system)

Skip to step 5 and let the CEO import issues itself during its first heartbeat. This is the fuller test — it exercises #6, #7, #10, and #13 all at once.

---

## Step 5 — Invoke the CEO heartbeat

Call:

```
paperclipApiRequest({
  method: "POST",
  path: "/api/agents/<ceoAgentId>/heartbeat/invoke"
})
```

**Expected response:**

```json
{ "runId": "...", "status": "queued" }
```

**Verify before moving on:**
- Watch `http://localhost:5173` — the CEO agent status should flip from `idle` to `running` within a few seconds.
- After the run completes (1–3 minutes), call `paperclipListIssues({ companyId: "<company.id>" })` and confirm ~40–50 issues have been imported.

**If it fails — `process_lost` error:**
- This is issue #15 (open bug). The CEO process starts but exits before making its first API call.
- **Workaround:** Import issues manually using Option A (step 4) or by creating them one at a time with `paperclipCreateIssue`. Then assign them to specialists individually. The auto-triage flow will not work until #15 is fixed. Track progress on [issue #15](https://github.com/NoobyGains/paperclip/issues/15).

**If the run times out:**
- The default timeout may be too short. Go to the CEO agent settings in the UI and increase `timeoutSec` to 300 (5 minutes).

> **[blocked: pending #13 commit]** The CEO's first-contact prompt (which reads the repo, imports GH issues, and fires triage) requires #13 to be committed. Until then, Option A is the safer import path.

---

## Step 6 — Watch it work

Once issues are imported and the CEO has triaged them, Paperclip runs autonomously. Here is what to watch:

**In the UI at `http://localhost:5173`:**
- Issues should appear with triage comments from the CEO.
- Specialist agents should start appearing in the Agents panel as the CEO hires them.
- Issues should move from `todo` → `in_progress` → `in_review` → `done`.

**Via MCP — check for stuck issues:**

```
paperclipApiRequest({
  method: "GET",
  path: "/api/companies/<companyId>/issues?status=blocked"
})
```

Any issues stuck on `blocked` need your attention. Read the comment on the issue — it will say what is blocking and who needs to act.

**Via the activity log:**

```
paperclipApiRequest({
  method: "GET",
  path: "/api/companies/<companyId>/activity"
})
```

This gives a full trace of every action taken.

---

## Success Signal

A successful dogfood run looks like this:

- [ ] "Paperclip workspace" company exists with a CEO agent.
- [ ] At least 40 issues imported from `NoobyGains/paperclip` (open GH issues).
- [ ] CEO has posted triage comments on imported issues.
- [ ] At least 3 specialist agents hired by the CEO (e.g. Backend Engineer, Frontend Engineer, QA).
- [ ] At least 1 issue has moved to `in_review` status with a specialist comment and a reviewer response.
- [ ] At least 1 issue has reached `done` without any manual board intervention after initial setup.

---

## Known Blockers

| Issue | Status | Impact |
|-------|--------|--------|
| **#15** — `claude_local` process exits before first API callback | Open | CEO heartbeat fails. Workaround: import issues manually (Option A in step 4), then use `codex_local` for specialists instead. |
| **#13** — CEO first-contact prompt | Pending commit | CEO will not auto-import and auto-triage issues without this. |
| **#6** — `defaultHireAdapter` wired | Pending commit | `paperclipBootstrapApp` and `paperclipUpdateCompanySettings` require this. Manual workaround via `paperclipApiRequest` described in steps 1–3. |
| **#7** — auto-review wired | Pending commit | `autoReviewEnabled` has no effect until this ships. |
| **#11** — GH bridge | Pending commit | Option A (bulk sync) requires this. Option B (CEO heartbeat) works without it if #13 and #15 are fixed. |

**Safe starting point today (while blockers are open):**
1. Create the company and CEO manually via the UI.
2. Import issues using `paperclipCreateIssue` in a loop (use `gh issue list --repo NoobyGains/paperclip --json number,title,body --limit 50` to get the list).
3. Assign issues to a `codex_local` specialist you hire manually.
4. Manually invoke heartbeats per agent via `paperclipApiRequest`.

---

## Post-Run Verification

After the first full loop, verify:

**Activity log should show:**
- CEO agent: `heartbeat_run_started`, `issue_created` (x40+), `issue_commented` (triage notes), `agent_created` (specialists)
- Specialist agents: `issue_checkout`, `issue_updated` (status transitions), `issue_commented` (progress notes)
- Reviewer agent: `issue_updated` (review decisions)

**UI at `http://localhost:5173` should show:**
- "Paperclip workspace" in the company list
- Agents panel: CEO + reviewer + 3–5 specialists
- Issues panel: 40+ issues, most in `todo` or `in_progress`, some in `in_review` or `done`
- Activity feed: continuous stream of agent actions

**Dashboard:**
```
paperclipApiRequest({
  method: "GET",
  path: "/api/companies/<companyId>/dashboard"
})
```
Should show non-zero `issuesByStatus`, `agentCount`, and `recentActivity`.

---

## Troubleshooting

### "CEO shows `error` status immediately"

Check the run logs:
1. In the UI, click the CEO agent → Runs tab → click the failed run.
2. Look at the error message and stderr excerpt.
3. Common causes:
   - `claude` CLI not installed or not logged in — run `claude --version` and `claude login`.
   - Wrong `cwd` in agent config — should point to the paperclip repo root.
   - `process_lost` — see issue #15.

### "No issues appear after CEO heartbeat"

The CEO may not have run its first-contact flow yet:
- Check the CEO's run log for any Paperclip API calls. If there are none, the process exited early (issue #15).
- If runs show API calls but no issues: the first-contact prompt may not be committed yet (issue #13).
- Fallback: use the GH bridge sync (step 4, Option A) once #11 ships.

### "Specialists are not being hired"

- `requireBoardApprovalForNewAgents` may be overriding `autoHireEnabled`. Verify via `paperclipApiRequest({ method: "GET", path: "/api/companies/<id>" })`.
- The CEO may be waiting for board approval. Check `paperclipListApprovals({ companyId: "<id>" })` for pending `hire_agent` approvals.
- #6 not yet committed — `autoHireEnabled` has no effect. Hire manually.

### "Issues are stuck in `in_review`"

- The reviewer agent may not have been invoked. Manually trigger it: `paperclipApiRequest({ method: "POST", path: "/api/agents/<reviewerAgentId>/heartbeat/invoke" })`.
- Check that `defaultReviewerAgentId` is set correctly on the company.
- #7 not yet committed — `autoReviewEnabled` has no effect.

### "Activity log shows nothing"

- Call `paperclipApiRequest({ method: "GET", path: "/api/companies/<id>/activity" })` directly.
- If the array is empty, no mutations have occurred — confirm the bootstrap completed successfully.

### Diagnostic tools

| Tool | What it tells you |
|------|------------------|
| `paperclipListAgents` | Whether agents were hired |
| `paperclipListIssues` | Whether issues were imported and their current status |
| `paperclipListApprovals` | Whether there are pending hire/spend approvals blocking progress |
| `paperclipApiRequest GET /api/companies/<id>/activity` | Full audit trail |
| `paperclipApiRequest GET /api/companies/<id>/dashboard` | High-level health metrics |
| `paperclipApiRequest GET /api/agents/<id>` | Agent status, last run, budget |
| UI → Agent → Runs tab | Per-run logs, stderr, token usage |

---

## Worktree Isolation (Recommended)

The CEO writes to the repo. If it commits a bad migration, your running server may crash.

To isolate the CEO's writes:

```sh
git worktree add ../paperclip-dogfood-ceo main
```

Then in the CEO agent config, set `cwd` to that worktree path instead of the main repo. The CEO works in the worktree, proposes changes as branches, and never touches your live checkout.
