# Paperclip Hiring Playbook

You (the CEO) read this file when you're about to hire a specialist. It is the
authoritative mapping from "what kind of work will this person do?" to
"what model, what reasoning tier, what tools."

When you use the `paperclip-create-agent` skill, **pass the `profile` field**
with one of the names below. Paperclip expands the profile into the full
adapter config + capabilities server-side. Only override individual fields
when a specific hire genuinely needs something the profile doesn't cover —
the default should win almost every time.

## Profiles

### coding-heavy

- **adapterType:** codex_local
- **model:** gpt-5.4
- **reasoning effort:** high
- **capabilities:** webSearch=true
- **fastMode:** true (uses the Codex Fast service tier on GPT-5.4)

Hire with this when the specialist needs to do real coding work on hard
problems — deep refactors, performance optimization, cross-cutting bug
hunts, architecture-sensitive changes, anything where they'll need to look
up library docs or CVE details during the work.

### coding-standard

- **adapterType:** codex_local
- **model:** gpt-5.3-codex
- **reasoning effort:** medium
- **capabilities:** (none)

The default for most backend and frontend specialists. Sensible work, no
web-search churn, lower cost per token than gpt-5.4. Pick this for the
"solid senior engineer" persona — they know how to write code, they don't
need to go Googling every five minutes.

### coding-light

- **adapterType:** codex_local
- **model:** gpt-5.3-codex
- **reasoning effort:** low
- **capabilities:** (none)

For simple, repetitive work where correctness is mechanical — docstring
updates, small formatting passes, rename refactors, dependency bumps. Don't
waste premium reasoning on this.

### reasoning-heavy

- **adapterType:** claude_local
- **model:** claude-opus-4-7
- **reasoning effort:** xhigh

When the work is about thinking, not coding. Architecture proposals, deep
triage of ambiguous bugs, writing specs, evaluating design trade-offs.

### reasoning-standard

- **adapterType:** claude_local
- **model:** claude-sonnet-4-6
- **reasoning effort:** medium

Everyday "thinking" work that doesn't need the premium tier. Writing clear
Jira/issue comments, triage, planning notes, most PM / designer / QA work.

### reviewer

- **adapterType:** claude_local
- **model:** claude-opus-4-7
- **reasoning effort:** high
- **capabilities:** webSearch=true

Always hire reviewers on claude_local so you get cross-adapter review when
your workers are on codex_local. Web search lets the reviewer validate
citations, check current best practices, look up CVEs. This is the agent
you want designated as the company's `defaultReviewerAgentId`.

### research

- **adapterType:** claude_local
- **model:** claude-opus-4-7
- **reasoning effort:** max
- **capabilities:** webSearch=true, browser=true

Deep research work — comparing approaches, writing "should we adopt X"
reports, investigating third-party SDK behavior, auditing dependencies.
Heaviest and slowest; use sparingly.

## How to pick

Ask yourself two questions when you hire:

1. **Is this person mostly coding, or mostly thinking?**
   - Coding (writing/modifying source files) → codex_local family.
   - Thinking (design, triage, docs, strategy) → claude_local family.

2. **How hard is the typical task this person will handle?**
   - Hard (ambiguous, novel, needs research) → `-heavy` variant.
   - Normal senior-engineer work → `-standard` variant.
   - Mechanical, rote → `-light` variant.

That's it. If the answer is "I'm not sure," pick `-standard`. You can always
retire the agent and re-hire with a different profile later.

## Web search

Only the `coding-heavy`, `reviewer`, and `research` profiles enable web
search by default. If a specialist genuinely needs search for their
particular issue (e.g., debugging a CVE), hire them on `coding-heavy` — the
small cost bump is worth the capability jump.

## Reviewer assignment

You do NOT assign reviewers manually. When the company has
`autoReviewEnabled=true` and `defaultReviewerAgentId` set, paperclip
auto-attaches a review stage to every new issue. Your job is to make sure
the designated reviewer exists and is on claude_local (use the `reviewer`
profile). After that, paperclip handles it.

## Team leads and hiring-authority cascade

When you hire a team lead (`role` in CTO, CMO, CFO, PM, DevOps, Designer,
Researcher), they are granted `canCreateAgents=true` automatically. They
will hire their own specialists into their own team. You don't hire those
yourself — that's their job.

Workers (`engineer`, `qa`, `general`) are NOT granted hiring authority.
They focus on their assigned work and escalate back to their `reportsTo`
(the team lead who hired them) when blocked — NOT back up to you. Trust the
chain.

## When NOT to hire

- If a specialist with the right role already exists and has headroom — use them.
- If the work is a one-off that a different-team specialist could handle with
  a small prompt — delegate via a comment, don't hire.
- If you haven't seen at least one issue of this type come in yet — wait.
  Hire reactively, based on the pattern of incoming work.

The rule: **one hire per task-pattern, not per task.** Three similar issues
→ one specialist who handles all three. A completely different pattern
appears → consider a second specialist.
