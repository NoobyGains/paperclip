# MCP Resource Convention: Live Rendering

Every `paperclip://*` resource registered in `packages/mcp-server/src/resources.ts` **must render
from live state**. That means the `read()` function issues a network request (or equivalent live
query) every time it is called. It must not read from a variable that was assigned at module load
time or at server startup.

## Why

MCP clients may cache resource contents themselves with their own TTL. If the server additionally
serves a stale snapshot, the client sees double-stale data. Serving live data on every call keeps
the server side out of the caching equation.

## What "live" means

- The `read()` function is `async` and calls `client.requestJson(...)`, `client.fetchRawText(...)`,
  `client.getMyProfile()`, or a helper like `diagnoseCompany(client)` that itself performs a
  network request.
- No module-scoped `let cache = ...` is populated outside `read()`.
- A TTL-backed cache inside `read()` is acceptable only when the underlying endpoint is known to be
  expensive and the data is not time-critical — it must be documented in the table below under
  "Cached (reason)".

## Convention for new resources

1. Accept `client: PaperclipApiClient` as a closure parameter (via `createResourceDefinitions`).
2. Implement `read()` as an `async` function that issues exactly one outbound request (or a small
   fan-out like `diagnoseCompany`).
3. Do not assign the result to a module-level variable.
4. Add a row to the audit table below.
5. Add at least one vitest in `resources.test.ts` that stubs `fetch`, calls `read()`, and asserts
   the response reflects what the stub returned — not a value from before the stub was installed.

---

## Audit table — all `paperclip://*` resources (audited 2026-04-18)

| URI | Name | Status | Notes |
|-----|------|--------|-------|
| `paperclip://company/summary` | Company summary | **Live** | `GET /companies/:id` on every read |
| `paperclip://agents` | Agents | **Live** | `GET /companies/:id/agents` on every read |
| `paperclip://issues/open` | Open issues | **Live** | `GET /companies/:id/issues?status=in_progress` on every read |
| `paperclip://issues/blocked` | Blocked issues | **Live** | `GET /companies/:id/issues?status=blocked` on every read |
| `paperclip://runs/recent` | Recent heartbeat runs | **Live** | `GET /companies/:id/heartbeat-runs?limit=50` on every read |
| `paperclip://approvals/pending` | Pending approvals | **Live** | `GET /companies/:id/approvals?status=pending` on every read |
| `paperclip://stuck` | Stuck diagnostics | **Live** | `diagnoseCompany()` fan-out — 5 parallel live requests on every read |
| `paperclip://routines/schedule` | Routine schedule | **Live** | `GET /companies/:id/routines` on every read |
| `paperclip://docs/operator-guide` | Operator guide | **Live** | `GET /llms/operator-context.txt` on every read — no server-side cache |
| `paperclip://docs/first-run` | First-run guide | **Live** | `GET /llms/first-run.txt` on every read — no server-side cache |
| `paperclip://hiring-playbook` | Hiring playbook | **Live** | `GET /llms/hiring-playbook.txt` on every read — no server-side cache |
| `paperclip://me/profile` | Operator profile | **Live** | `GET /me/profile` on every read via `client.getMyProfile()` |
| `paperclip://adapters` | Enabled adapters | **Live** | `GET /adapters` on every read |

**Result: 0 cached resources found. No fixes required.**

All 13 resources invoke the Paperclip API (or a static-file endpoint that behaves as live) on each
`read()` call. No module-scoped mutable variables, no startup-time snapshots.
