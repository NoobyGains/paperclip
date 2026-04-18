# Paperclip MCP Server

Model Context Protocol server for Paperclip.

This package is a thin MCP wrapper over the existing Paperclip REST API. It does
not talk to the database directly and it does not reimplement business logic.

## Authentication

The server reads its configuration from environment variables:

- `PAPERCLIP_API_URL` - Paperclip base URL, for example `http://localhost:3100`
- `PAPERCLIP_API_KEY` - bearer token used for `/api` requests
- `PAPERCLIP_COMPANY_ID` - optional default company for company-scoped tools
- `PAPERCLIP_AGENT_ID` - optional default agent for checkout helpers
- `PAPERCLIP_RUN_ID` - optional run id forwarded on mutating requests

## Usage

```sh
npx -y @paperclipai/mcp-server
```

Or locally in this repo:

```sh
pnpm --filter @paperclipai/mcp-server build
node packages/mcp-server/dist/stdio.js
```

## Tool Surface

Read tools:

- `paperclipMe`
- `paperclipInboxLite`
- `paperclipListAgents`
- `paperclipGetAgent`
- `paperclipListIssues`
- `paperclipGetIssue`
- `paperclipGetHeartbeatContext`
- `paperclipListComments`
- `paperclipGetComment`
- `paperclipListIssueApprovals`
- `paperclipListDocuments`
- `paperclipGetDocument`
- `paperclipListDocumentRevisions`
- `paperclipListProjects`
- `paperclipGetProject`
- `paperclipListGoals`
- `paperclipGetGoal`
- `paperclipListApprovals`
- `paperclipGetApproval`
- `paperclipGetApprovalIssues`
- `paperclipListApprovalComments`
- `paperclipListAgentHires`
- `paperclipGetCompanySettings`
- `paperclipListRoutines`
- `paperclipGetRoutine`
- `paperclipListCompanySkills`

Write tools:

- `paperclipCreateIssue`
- `paperclipUpdateIssue`
- `paperclipCheckoutIssue`
- `paperclipReleaseIssue`
- `paperclipAddComment`
- `paperclipUpsertIssueDocument`
- `paperclipRestoreIssueDocumentRevision`
- `paperclipCreateApproval`
- `paperclipLinkIssueApproval`
- `paperclipUnlinkIssueApproval`
- `paperclipApprovalDecision`
- `paperclipAddApprovalComment`
- `paperclipCreateAgentHire`
- `paperclipUpdateCompanySettings`
- `paperclipReleaseStaleExecutionLock`
- `paperclipForceReleaseExecutionLock`
- `paperclipPreviewCompanyImport`

Diagnostic tools (composite reads — answer "why is X stuck?" in one call):

- `paperclipDiagnoseIssue` — issue + current run + blockers + recent comments + `suggestedAction`
- `paperclipDiagnoseAgent` — agent + recent runs + locked issues + open hire approval
- `paperclipDiagnoseCompany` — paused agents, stale-lock issues, overdue approvals, overdue routines

Escape hatch:

- `paperclipApiRequest`

`paperclipApiRequest` is limited to paths under `/api` and JSON bodies. It is
meant for endpoints that do not yet have a dedicated MCP tool.

## Resources (state snapshots)

In addition to tools, the server registers nine MCP resources so an operator
can read paperclip's current state without hunting for individual endpoints.
Point an MCP client at these URIs:

| URI | Purpose |
| --- | --- |
| `paperclip://company/summary` | Company record + board settings + pause + budget |
| `paperclip://agents` | All agents with status, adapter, lastHeartbeatAt |
| `paperclip://issues/open` | Issues in `in_progress` status |
| `paperclip://issues/blocked` | Blocked issues + blockedByIssueIds |
| `paperclip://runs/recent` | Last 50 heartbeat runs |
| `paperclip://approvals/pending` | Pending approvals |
| `paperclip://stuck` | One-shot health check (see below) |
| `paperclip://routines/schedule` | Routines with nextRunAt, lastTriggeredAt |
| `paperclip://docs/operator-guide` | The Operator Context Pack — paperclip's feature reference, served by the server's `/llms/operator-context.txt` endpoint |

Read `paperclip://docs/operator-guide` once when connecting — it documents
paperclip's concepts (agents, issues, runs, approvals, execution policy,
routines, adapters) with the diagnostic fields that matter and the common
stuck modes. Read `paperclip://stuck` first when the board asks
"anything stuck?" — it returns paused agents, stale-lock issues, overdue
approvals, and overdue routines in one blob.

## Recovering a stuck issue

When an external operator asks "why is this issue stuck?", call
`paperclipDiagnoseIssue` first. The response includes a `staleLock` flag and a
`suggestedAction` string that points at the correct recovery tool. For the
common case (the run has crashed), the flow is:

1. `paperclipDiagnoseIssue({ issueId })` → returns `staleLock: true`.
2. `paperclipReleaseStaleExecutionLock({ issueId })` → safely releases the lock
   only if the run is terminal or missing; does nothing if still active.
3. Reassign or checkout the issue as needed.

For the rare case where the run is wedged but not terminal, `paperclipForceReleaseExecutionLock`
is available to board users only and records a reason in the activity log.
