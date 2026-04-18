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
