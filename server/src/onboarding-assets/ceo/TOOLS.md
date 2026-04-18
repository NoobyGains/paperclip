# Tools

You are a `claude_local` agent. This file is your reference for every tool surface you have access to. Read it once per session. Consult it before reaching for a tool you haven't used recently.

---

## 1. Paperclip HTTP API

**Base URL:** `$PAPERCLIP_API_URL` (set in your environment). All paths live under `/api`.

**Authentication:** Pass `$PAPERCLIP_API_KEY` as a bearer token on every request.

```sh
curl -sS "$PAPERCLIP_API_URL/api/agents/me" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY"
```

**Mutating calls** (POST, PATCH, PUT, DELETE) must include the `X-Paperclip-Run-Id` header. The run ID is available in `$PAPERCLIP_RUN_ID`.

```sh
-H "X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID"
```

**Discovery docs** served from the API server itself:

| Path | What it covers |
|---|---|
| `GET /llms/agent-configuration.txt` | Installed adapter types and their config doc paths |
| `GET /llms/agent-configuration/:adapterType.txt` | Full config reference for one adapter (e.g. `claude_local`) |
| `GET /llms/agent-icons.txt` | Valid icon names for agent hire payloads |

Fetch these when you're about to hire an agent and need current adapter config options. Do not guess field names from memory.

---

## 2. Key Endpoints

You will use these constantly. Memorize the shape; look up the payload schema in the referenced skill when you need it.

| Operation | Method + Path | Notes |
|---|---|---|
| Who am I | `GET /api/agents/me` | Returns your id, companyId, role, budget, chainOfCommand |
| List my assignments | `GET /api/companies/{companyId}/issues?assigneeAgentId={id}&status=todo,in_progress,in_review,blocked` | Primary task feed |
| Get one issue | `GET /api/issues/{id}` | id can be UUID or identifier |
| Create issue / subtask | `POST /api/companies/{companyId}/issues` | Always set `parentId` and `goalId` on subtasks |
| Update issue status or fields | `PATCH /api/issues/{id}` | Use `status`, `assigneeAgentId`, `blockedByIssueIds`, etc. |
| Checkout issue | `POST /api/issues/{id}/checkout` | Sets you as active executor; returns 409 if already owned — never retry |
| Release issue | `POST /api/issues/{id}/release` | Frees the checkout without closing the issue |
| Add comment | `POST /api/issues/{id}/comments` | Body is markdown; required before exiting any active task |
| List company agents | `GET /api/companies/{companyId}/agents` | Use to find an agent by role before assigning work |
| Submit agent hire | `POST /api/companies/{companyId}/agent-hires` | See `paperclip-create-agent/SKILL.md` for full payload shape |
| List existing configs | `GET /api/companies/{companyId}/agent-configurations` | Reference before drafting a new hire config |
| Get approval | `GET /api/approvals/{id}` | Check approval status when woken with `PAPERCLIP_APPROVAL_ID` |
| Comment on approval | `POST /api/approvals/{id}/comments` | Use to discuss hire requests in-flight |

For the complete payload schema on any of these, see `skills/paperclip-create-agent/references/api-reference.md`.

---

## 3. Hiring

Hiring is one of your most important actions. Do it deliberately.

**Step 1 — profile selection.** Before drafting a hire payload, read:
- `GET /llms/agent-configuration.txt` — which adapters are installed in this environment
- `GET /llms/agent-configuration/{adapterType}.txt` — field-by-field config options for the adapter you'll use

There is no static `HIRING_PLAYBOOK.md` in your bundle. Profile selection is runtime-dynamic; fetch the discovery docs above to get current options.

**Step 2 — submit the hire.** Use `skills/paperclip-create-agent/SKILL.md`. That file is your authoritative reference for:
- the full hire payload shape
- how to set `reportsTo`, `icon`, `desiredSkills`, heartbeat settings
- governance flow (pending_approval state, approval thread, `PAPERCLIP_APPROVAL_ID` wake)
- quality bar checklist before you submit

Critical constraints:
- Do **not** pass `adapterType` when you want the company default to win. Omit the field; the server selects it.
- Do **not** set `runtimeConfig.heartbeat.enabled: true` unless the role genuinely requires scheduled autonomous runs. Prefer `wakeOnDemand: true`.
- Do **not** hard-code secrets in adapter config.

---

## 4. `gh` CLI — GitHub Issue and PR Access

When the project has a `github.com` remote, you can read issues and PRs directly. This is read-only context gathering, not work execution.

**List open issues:**

```sh
gh issue list --limit 30
```

**View a specific issue:**

```sh
gh issue view 1234
```

**List open PRs:**

```sh
gh pr list --limit 20
```

**View a specific PR:**

```sh
gh pr view 567
```

**List comments on a PR (API):**

```sh
gh api repos/{owner}/{repo}/pulls/567/comments
```

Use `gh` to understand what the board or contributors have reported before you create Paperclip tasks. Map GitHub issues to Paperclip issues; do not duplicate effort.

---

## 5. Shell Tools

As a `claude_local` agent you have the standard Claude Code tool surface available by default:

- **Read / Write / Edit** — file access within your workspace
- **Glob** — pattern-based file discovery
- **Grep** — content search
- **Bash** — general shell execution (curl, git read operations, diagnostics)

These are enough for memory operations, reading skill files, calling the API via curl, and inspecting the repo.

**WebSearch**, when enabled by your operator, gives you internet access. Use it for:
- Looking up library documentation or API specs
- Researching a technology before delegating a spike to a report
- Verifying that a third-party service or tool still exists before including it in a plan

WebSearch is not always enabled. Check whether you got search results before concluding anything. If it is not available, delegate research tasks to a report who has it.

---

## 6. MCP (Operator-Connected Mode)

If a board member connects to your company via the Paperclip MCP server, they gain a set of tools that operate on your company's data. They may report findings to you via task comments or approval threads. Tools exposed by the MCP include:

- `paperclipDiagnoseCompany` — board-level snapshot of company health
- `paperclipDiagnoseIssue` — detailed issue diagnosis
- `paperclipHireWithProfile` — structured hire flow from the board side
- `paperclipListHiringProfiles` — available hiring profiles configured for this instance
- Resource `paperclip://stuck` — summary of blocked or stale work

You do not invoke MCP tools yourself. The operator Claude invokes them. Watch for comments on your issues that reference MCP findings and act on them as you would any other input from the board.

---

## 7. `para-memory-files` Skill

All memory operations — reading past context, writing daily notes, storing facts, running synthesis, managing plans — go through this skill.

Invoke it by reading `skills/para-memory-files/SKILL.md` and following its protocol. Do not free-write to memory files outside the skill's defined folder structure.

---

## 8. Things You Must Not Do

- **Do not manually attach review stages to issues.** The auto-review system handles execution policy transitions. Setting reviewers or approval stages by hand will conflict with it.
- **Do not pass `adapterType` when you want the default.** Omit it. Passing an explicit type overrides the company default and may break the hire on environments with different adapters.
- **Do not push to git remotes.** You may read git history with `git log` and `git diff`. You may not commit, push, or force-push. Git write operations require explicit board approval.
- **Do not modify your own `AGENTS.md`.** That file is provisioned by the operator. If you need to update your operating instructions, raise it with the board and let them edit it.
- **Do not retry a 409 on checkout.** That issue belongs to another active run. Move on.
- **Do not self-assign work that was not assigned or @-mentioned to you.** Pull from your assignment queue only.
