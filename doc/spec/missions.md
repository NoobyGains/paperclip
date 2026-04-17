# Issue-Backed Missions

Status: V1 product contract for the first Missions slice
Date: 2026-04-17

## Product Contract

A Mission is a managed execution mode over the existing Paperclip control plane. It is not a second task system, a chat surface, or a new agent runtime. A Mission is anchored by a company-scoped issue and uses normal issue documents, child issues, blockers, heartbeat runs, approvals, activity logs, work products, attachments, costs, and budget hard-stops.

The mission issue is the source of truth for the user outcome and shared state. Child issues remain the source of truth for execution. Parentage explains structure; explicit blockers encode dependencies. Agents still use checkout semantics, single-assignee ownership, comments, and heartbeat runs. Validators judge outcomes in fresh runs and do not patch code directly.

## Required Documents

Mission shared state is stored as issue documents on the mission issue. Required stable keys are:

- `plan`: human-readable implementation plan.
- `mission-brief`: goal, constraints, assumptions, scope, non-goals, stakeholders, and current status.
- `validation-contract`: finite testable assertions that define success before feature decomposition.
- `features`: feature and milestone list that claims validation assertions.
- `worker-guidelines`: role boundaries, testing expectations, workspace rules, and forbidden actions.
- `services`: app commands, preview URLs, test accounts, seeded data, environment needs, and setup costs.
- `knowledge-base`: concise discoveries future workers or validators need.
- `decision-log`: orchestrator decisions, waivers, and rationale.

Generated document keys are:

- `validation-report-round-N`, where `N` starts at 1.
- `milestone-summary-slug`, where `slug` is a lowercase document-key-safe milestone slug.
- `mission-final-report`.

MVP documents are markdown at the storage layer. Structured documents should embed JSON or YAML that conforms to the shared validators in `packages/shared/src/validators/mission.ts` when server code needs machine-readable parsing.

## Validation Assertions

The validation contract must exist before decomposition. Each assertion is finite, behavior-focused, and externally testable where possible.

Canonical fields:

- `id`: stable ID such as `VAL-MISSION-001`.
- `title`: short behavior name.
- `user_value`: why the assertion matters.
- `scope`: product area or workflow.
- `setup`: required data, server state, authentication, or project state.
- `steps`: ordered validator actions.
- `oracle`: pass/fail rule.
- `tooling`: required tooling such as `unit_test`, `api_call`, `browser`, `screenshot`, `log_inspection`, `code_review`, `cli_command`, `manual_review`, or `other`.
- `evidence`: required artifacts, with kind, description, and whether each is required.
- `claimed_by`: feature IDs expected to satisfy it.
- `status`: `unclaimed`, `claimed`, `passing`, `failing`, `blocked`, or `waived`.

## Features

The `features` document groups feature specs by milestone. Original features must claim at least one validation assertion. Fix features must reference a source finding.

Canonical feature fields:

- `id`: stable ID such as `FEAT-MISSION-001`.
- `title`: concise feature name.
- `kind`: `original` or `fix`.
- `summary`: bounded implementation scope.
- `acceptance_criteria`: concrete completion checks.
- `claimed_assertion_ids`: validation assertion IDs this feature is intended to satisfy.
- `status`: `planned`, `in_progress`, `implemented`, `validating`, `accepted`, `blocked`, or `cancelled`.
- `source_finding_id`: required for fix features.

Canonical milestone fields:

- `id`: stable ID such as `MILESTONE-MISSION-001`.
- `title`: milestone name.
- `summary`: why the group exists.
- `features`: non-empty feature list.

## Findings

Validators post structured findings so the orchestrator can create bounded fix issues or waivers.

Canonical fields:

- `id`: stable ID such as `FINDING-MISSION-001`.
- `severity`: `blocking`, `non_blocking`, or `suggestion`.
- `assertion_id`: related validation assertion, required for blocking findings.
- `title`: concise issue.
- `evidence`: links, attachments, command output references, screenshots, or work products.
- `repro_steps`: how to observe the issue.
- `expected`: expected behavior.
- `actual`: observed behavior.
- `suspected_area`: optional file, module, route, or workflow.
- `recommended_fix_scope`: small fix proposal; required when status is `fix_created`.
- `status`: `open`, `fix_created`, `waived`, or `resolved`.

Blocking findings are converted into bounded fix issues by mission advance. The generated fix issue uses normal issue
parentage, billing, workspace inheritance, and blocker relationships. Its description links back to the validation report
document key, assertion, evidence, reproduction steps, and recommended scope. The milestone's fix-loop issue remains
blocked by active fix issues so completion cannot hide unresolved validation work.

Non-blocking and suggestion findings can be waived through the mission finding waiver route. Waivers are recorded as
stable marker entries in the mission issue's `decision-log` document with a rationale, actor label, and timestamp. Mission
summary projections combine validation reports, generated fix issues, and decision-log waivers to compute finding counts,
severity counts, assertion mappings, evidence, and fix status.

## State Derivation

MVP mission state is derived from issue and document state rather than a new table.

- `cancelled`: mission issue is `cancelled`.
- `paused`: budget or operator policy has paused scheduling.
- `blocked`: mission issue is `blocked` or unresolved blocking findings exist.
- `completed`: mission issue is `done` and `mission-final-report` exists.
- `draft`: `mission-brief` or `validation-contract` is missing.
- `ready_for_approval`: required planning documents exist and approval is required before scheduling.
- `planning`: validation contract exists but feature decomposition is missing or no active work is scheduled yet.
- `fixing`: active fix issues exist.
- `validating`: active validation issues exist.
- `running`: active original feature issues exist.

Issue status remains the execution status. Mission state is a projection for summaries and UI.

## Governance Rules

- Mission routes and services must enforce company access.
- Mission scheduling must not bypass issue checkout, single-assignee ownership, activity logging, approval gates, or budget hard-stops.
- Blockers are first-class issue relationships, not free-text comments.
- Work products and attachments hold validation evidence.
- Board/operator users can pause, cancel, approve, or inspect through normal issue and approval surfaces.
- Validators report findings; orchestrators decide fix issues, waivers, and final recommendation.
