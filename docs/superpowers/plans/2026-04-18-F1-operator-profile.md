# F1 — Operator profile + subscriptionOnly flag — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist an operator-level profile (subscription declarations + preferences) in a new `user_profiles` table and expose it via REST + three MCP surfaces (one read tool, one write tool, one resource). Default `subscriptionOnly: true` for new operators — safe default for a subscription-backed user base.

**Architecture:** One new Postgres table (`user_profiles`) keyed by `authUsers.id`, accessed through a thin Drizzle service that auto-creates a defaults row on first read. One Express router (`GET`/`PATCH /api/me/profile`) that reuses the existing board-user authz helpers. MCP client gains two helper methods; two new tools + one resource added to the MCP server.

**Tech Stack:** Drizzle ORM (raw-SQL migrations + TypeScript schema), Express, Zod validators in `@paperclipai/shared`, MCP server in `@paperclipai/mcp-server`, Vitest for tests.

**Tracking:** [GitHub issue #17](https://github.com/NoobyGains/paperclip/issues/17) on `NoobyGains/paperclip`. Branch: `fix/F1-operator-profile`.

**Spec reference:** `docs/superpowers/specs/2026-04-18-self-teaching-paperclip-design.md` — Amplifier 1 section.

---

## File Structure

**New files:**

- `packages/db/src/schema/user_profiles.ts` — Drizzle schema for the new table.
- `packages/db/src/migrations/0063_user_profiles.sql` — raw-SQL migration.
- `packages/shared/src/types/user-profile.ts` — `UserProfile` type + `subscriptionPlanSchema`.
- `packages/shared/src/validators/user-profile.ts` — `updateUserProfileSchema` (Zod).
- `server/src/services/user-profiles.ts` — `userProfileService(db)` with `getProfile` + `updateProfile`.
- `server/src/routes/me-profile.ts` — Express router for `/api/me/profile` GET + PATCH.
- `server/src/__tests__/user-profiles.test.ts` — service + route integration tests.

**Modified files:**

- `packages/db/src/schema/index.ts` — export new table.
- `packages/db/src/migrations/meta/_journal.json` — drizzle journal entry for 0063.
- `packages/shared/src/index.ts` — export new type + validator.
- `server/src/services/index.ts` — export `userProfileService`.
- `server/src/routes/index.ts` — mount `meProfileRoutes`.
- `packages/mcp-server/src/client.ts` — add `getMyProfile()` + `updateMyProfile(body)`.
- `packages/mcp-server/src/tools.ts` — add `paperclipGetMyProfile` + `paperclipUpdateMyProfile`; add to `TOOL_ANNOTATIONS`.
- `packages/mcp-server/src/resources.ts` — add `paperclip://me/profile` resource.
- `packages/mcp-server/src/tools.test.ts` — tool tests.

---

## Task 1: Drizzle schema for `user_profiles`

**Files:**
- Create: `packages/db/src/schema/user_profiles.ts`
- Modify: `packages/db/src/schema/index.ts`

- [ ] **Step 1: Create the schema file**

Write `packages/db/src/schema/user_profiles.ts`:

```ts
import { pgTable, text, timestamp, boolean, jsonb } from "drizzle-orm/pg-core";

export const userProfiles = pgTable("user_profiles", {
  userId: text("user_id").primaryKey(),
  subscriptionOnly: boolean("subscription_only").notNull().default(true),
  claudeSubscription: text("claude_subscription"),
  codexSubscription: text("codex_subscription"),
  preferences: jsonb("preferences").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
```

Pattern mirrors `packages/db/src/schema/user_sidebar_preferences.ts:3-15`. Note: `userId` is the primary key (one profile per user — no separate surrogate `id`). No FK to `user` yet — the auth `user` table lives in a separate Auth.js-managed space and we keep `user_profiles` decoupled (matches how `user_sidebar_preferences` does it).

- [ ] **Step 2: Export from schema index**

Modify `packages/db/src/schema/index.ts` — add a new line after the existing `userSidebarPreferences` export:

```ts
export { userProfiles } from "./user_profiles.js";
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @paperclipai/db typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/db/src/schema/user_profiles.ts packages/db/src/schema/index.ts
git commit -m "feat(#17): drizzle schema for user_profiles table"
```

---

## Task 2: Migration `0063_user_profiles.sql`

**Files:**
- Create: `packages/db/src/migrations/0063_user_profiles.sql`
- Modify: `packages/db/src/migrations/meta/_journal.json`

- [ ] **Step 1: Write the migration SQL**

Create `packages/db/src/migrations/0063_user_profiles.sql`:

```sql
CREATE TABLE IF NOT EXISTS "user_profiles" (
  "user_id" text PRIMARY KEY NOT NULL,
  "subscription_only" boolean DEFAULT true NOT NULL,
  "claude_subscription" text,
  "codex_subscription" text,
  "preferences" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
```

Pattern mirrors `packages/db/src/migrations/0060_adapter_defaults.sql` — raw SQL, idempotent `IF NOT EXISTS`.

- [ ] **Step 2: Append journal entry**

Modify `packages/db/src/migrations/meta/_journal.json`. Find the existing entries array (ends with the `0062_process_lost_telemetry` entry). Add before the closing `]`:

```json
{
  "idx": 63,
  "version": "7",
  "when": 1776700000000,
  "tag": "0063_user_profiles",
  "breakpoints": true
}
```

(Use `idx: 63` since the current max is `idx: 62`. `when` is a ms-epoch; use any value greater than `1745020800000`.)

- [ ] **Step 3: Run the migration**

Run: `pnpm db:migrate`
Expected: output includes `0063_user_profiles` applying cleanly.

- [ ] **Step 4: Verify in psql**

Run:
```bash
PGPASSWORD=paperclip "/c/Program Files/PostgreSQL/16/bin/psql.exe" -h localhost -p 5432 -U paperclip -d paperclip -c "\d user_profiles"
```
Expected: table listed with all 7 columns + correct defaults.

If embedded Postgres is in use instead, the migration runs against `~/.paperclip/instances/default/db`; verify via the server's `/api/health` endpoint returning `status: "ok"`.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/migrations/0063_user_profiles.sql packages/db/src/migrations/meta/_journal.json
git commit -m "feat(#17): migration 0063 — user_profiles table"
```

---

## Task 3: Shared type `UserProfile` + subscription-plan enum

**Files:**
- Create: `packages/shared/src/types/user-profile.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Create the type file**

Write `packages/shared/src/types/user-profile.ts`:

```ts
import { z } from "zod";

export const subscriptionPlanSchema = z.enum(["max", "pro", "plus", "api", "none"]);
export type SubscriptionPlan = z.infer<typeof subscriptionPlanSchema>;

export interface UserProfile {
  userId: string;
  subscriptionOnly: boolean;
  claudeSubscription: SubscriptionPlan | null;
  codexSubscription: SubscriptionPlan | null;
  preferences: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}
```

Timestamps are serialized as ISO-8601 strings across the API boundary. This matches `packages/shared/src/types/agent.ts` conventions.

- [ ] **Step 2: Export from shared index**

Modify `packages/shared/src/index.ts`. Add alongside existing type exports:

```ts
export type { UserProfile, SubscriptionPlan } from "./types/user-profile.js";
export { subscriptionPlanSchema } from "./types/user-profile.js";
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @paperclipai/shared typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/types/user-profile.ts packages/shared/src/index.ts
git commit -m "feat(#17): UserProfile type + subscription-plan enum"
```

---

## Task 4: Shared validator `updateUserProfileSchema`

**Files:**
- Create: `packages/shared/src/validators/user-profile.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Write failing test for the validator**

Create `packages/shared/src/__tests__/user-profile-validator.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { updateUserProfileSchema } from "../validators/user-profile.js";

describe("updateUserProfileSchema", () => {
  it("accepts a full valid payload", () => {
    const parsed = updateUserProfileSchema.parse({
      subscriptionOnly: false,
      claudeSubscription: "max",
      codexSubscription: "max",
      preferences: { theme: "dark" },
    });
    expect(parsed.subscriptionOnly).toBe(false);
    expect(parsed.claudeSubscription).toBe("max");
  });

  it("accepts an empty payload (PATCH)", () => {
    const parsed = updateUserProfileSchema.parse({});
    expect(parsed).toEqual({});
  });

  it("rejects an invalid subscription plan", () => {
    const result = updateUserProfileSchema.safeParse({ claudeSubscription: "enterprise" });
    expect(result.success).toBe(false);
  });

  it("allows null to clear a subscription", () => {
    const parsed = updateUserProfileSchema.parse({ claudeSubscription: null });
    expect(parsed.claudeSubscription).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @paperclipai/shared test:run src/__tests__/user-profile-validator.test.ts`
Expected: FAIL — `Cannot find module '../validators/user-profile.js'`.

- [ ] **Step 3: Write the validator**

Create `packages/shared/src/validators/user-profile.ts`:

```ts
import { z } from "zod";
import { subscriptionPlanSchema } from "../types/user-profile.js";

export const updateUserProfileSchema = z.object({
  subscriptionOnly: z.boolean().optional(),
  claudeSubscription: subscriptionPlanSchema.nullable().optional(),
  codexSubscription: subscriptionPlanSchema.nullable().optional(),
  preferences: z.record(z.unknown()).optional(),
}).strict();

export type UpdateUserProfileInput = z.infer<typeof updateUserProfileSchema>;
```

- [ ] **Step 4: Export from shared index**

Modify `packages/shared/src/index.ts` — add:

```ts
export { updateUserProfileSchema } from "./validators/user-profile.js";
export type { UpdateUserProfileInput } from "./validators/user-profile.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @paperclipai/shared test:run src/__tests__/user-profile-validator.test.ts`
Expected: PASS — all 4 cases.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/validators/user-profile.ts packages/shared/src/__tests__/user-profile-validator.test.ts packages/shared/src/index.ts
git commit -m "feat(#17): updateUserProfileSchema validator"
```

---

## Task 5: `userProfileService` — server-side DB access

**Files:**
- Create: `server/src/services/user-profiles.ts`
- Modify: `server/src/services/index.ts`
- Test: `server/src/__tests__/user-profiles.test.ts` (created in Task 10 — we don't write it yet; service is unit-testable but its test file is part of the integration test in Task 10).

- [ ] **Step 1: Write the service**

Create `server/src/services/user-profiles.ts`:

```ts
import { eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { userProfiles } from "@paperclipai/db";
import type { UserProfile, UpdateUserProfileInput } from "@paperclipai/shared";

function serializeProfile(row: typeof userProfiles.$inferSelect): UserProfile {
  return {
    userId: row.userId,
    subscriptionOnly: row.subscriptionOnly,
    claudeSubscription: (row.claudeSubscription ?? null) as UserProfile["claudeSubscription"],
    codexSubscription: (row.codexSubscription ?? null) as UserProfile["codexSubscription"],
    preferences: row.preferences ?? {},
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function userProfileService(db: Db) {
  return {
    async getProfile(userId: string): Promise<UserProfile> {
      const existing = await db.query.userProfiles.findFirst({
        where: eq(userProfiles.userId, userId),
      });
      if (existing) return serializeProfile(existing);

      // Auto-create with defaults on first access. subscriptionOnly defaults
      // to true per the initiative spec — safe default for a subs-backed user.
      const [created] = await db
        .insert(userProfiles)
        .values({ userId })
        .onConflictDoNothing()
        .returning();

      if (created) return serializeProfile(created);

      // Lost an insert race — re-read.
      const row = await db.query.userProfiles.findFirst({
        where: eq(userProfiles.userId, userId),
      });
      if (!row) throw new Error(`Failed to get-or-create user_profiles row for ${userId}`);
      return serializeProfile(row);
    },

    async updateProfile(userId: string, input: UpdateUserProfileInput): Promise<UserProfile> {
      await this.getProfile(userId); // ensure row exists

      const now = new Date();
      const patch: Partial<typeof userProfiles.$inferInsert> = { updatedAt: now };
      if (input.subscriptionOnly !== undefined) patch.subscriptionOnly = input.subscriptionOnly;
      if (input.claudeSubscription !== undefined) patch.claudeSubscription = input.claudeSubscription;
      if (input.codexSubscription !== undefined) patch.codexSubscription = input.codexSubscription;
      if (input.preferences !== undefined) patch.preferences = input.preferences;

      const [updated] = await db
        .update(userProfiles)
        .set(patch)
        .where(eq(userProfiles.userId, userId))
        .returning();

      if (!updated) throw new Error(`Failed to update user_profiles row for ${userId}`);
      return serializeProfile(updated);
    },
  };
}
```

Pattern mirrors `server/src/services/sidebar-preferences.ts` — same Drizzle upsert + serialization idiom.

- [ ] **Step 2: Export from services index**

Modify `server/src/services/index.ts`. Add alongside existing exports:

```ts
export { userProfileService } from "./user-profiles.js";
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @paperclipai/server typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add server/src/services/user-profiles.ts server/src/services/index.ts
git commit -m "feat(#17): userProfileService with auto-create-on-read"
```

---

## Task 6: Express routes `GET /api/me/profile` + `PATCH /api/me/profile`

**Files:**
- Create: `server/src/routes/me-profile.ts`
- Modify: `server/src/routes/index.ts`

- [ ] **Step 1: Create the router**

Create `server/src/routes/me-profile.ts`:

```ts
import { Router, type Request, type Response } from "express";
import type { Db } from "@paperclipai/db";
import { updateUserProfileSchema } from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { userProfileService } from "../services/index.js";
import { assertBoard } from "./authz.js";

function requireBoardUserId(req: Request, res: Response): string | null {
  assertBoard(req);
  if (!req.actor.userId) {
    res.status(403).json({ error: "Board user context required" });
    return null;
  }
  return req.actor.userId;
}

export function meProfileRoutes(db: Db) {
  const router = Router();
  const svc = userProfileService(db);

  router.get("/me/profile", async (req, res) => {
    const userId = requireBoardUserId(req, res);
    if (!userId) return;
    res.json(await svc.getProfile(userId));
  });

  router.patch("/me/profile", validate(updateUserProfileSchema), async (req, res) => {
    const userId = requireBoardUserId(req, res);
    if (!userId) return;
    res.json(await svc.updateProfile(userId, req.body));
  });

  return router;
}
```

Pattern mirrors `server/src/routes/sidebar-preferences.ts:1-30`.

- [ ] **Step 2: Mount the router**

Modify `server/src/routes/index.ts`. Find where `sidebarPreferenceRoutes` is imported + mounted. Add parallel lines:

```ts
import { meProfileRoutes } from "./me-profile.js";
// ...
router.use("/api", meProfileRoutes(db));
```

(Look for the existing `router.use("/api", sidebarPreferenceRoutes(db));` line and add the new mount right next to it.)

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @paperclipai/server typecheck`
Expected: no errors.

- [ ] **Step 4: Smoke check via running server**

Start server if not running: `pnpm dev`. In another terminal:

```bash
curl -s -H "Authorization: Bearer <your board API key>" http://localhost:3100/api/me/profile
```

Expected: a JSON object with `subscriptionOnly: true` (defaults), `claudeSubscription: null`, `codexSubscription: null`, `preferences: {}`, and ISO timestamps.

Then test PATCH:

```bash
curl -s -X PATCH -H "Authorization: Bearer <your board API key>" -H "Content-Type: application/json" \
  -d '{"claudeSubscription": "max", "codexSubscription": "max"}' \
  http://localhost:3100/api/me/profile
```

Expected: updated object echoed back.

Re-GET: confirm persistence.

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/me-profile.ts server/src/routes/index.ts
git commit -m "feat(#17): GET/PATCH /api/me/profile routes"
```

---

## Task 7: MCP client helpers `getMyProfile` + `updateMyProfile`

**Files:**
- Modify: `packages/mcp-server/src/client.ts`

- [ ] **Step 1: Add helper methods**

Modify `packages/mcp-server/src/client.ts`. Find the `PaperclipApiClient` class. Add two methods (alongside existing ones like `resolveCompanyId`):

```ts
async getMyProfile(): Promise<Record<string, unknown>> {
  return this.requestJson("GET", "/me/profile");
}

async updateMyProfile(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  return this.requestJson("PATCH", "/me/profile", { body });
}
```

(Exact method-body style matches existing `requestJson` callers in the file.)

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @paperclipai/mcp-server typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/mcp-server/src/client.ts
git commit -m "feat(#17): MCP client helpers for /api/me/profile"
```

---

## Task 8: MCP tools `paperclipGetMyProfile` + `paperclipUpdateMyProfile`

**Files:**
- Modify: `packages/mcp-server/src/tools.ts`
- Test: `packages/mcp-server/src/tools.test.ts`

- [ ] **Step 1: Write failing tests**

Modify `packages/mcp-server/src/tools.test.ts`. Add a new `describe` block at the bottom:

```ts
describe("operator profile tools (F1)", () => {
  it("paperclipGetMyProfile round-trips default profile", async () => {
    const client = mockClient({
      "GET /me/profile": {
        userId: "user_1",
        subscriptionOnly: true,
        claudeSubscription: null,
        codexSubscription: null,
        preferences: {},
        createdAt: "2026-04-18T00:00:00.000Z",
        updatedAt: "2026-04-18T00:00:00.000Z",
      },
    });
    const tool = getTool(client, "paperclipGetMyProfile");
    const result = await tool.handler({});
    expect(result.subscriptionOnly).toBe(true);
    expect(result.claudeSubscription).toBeNull();
  });

  it("paperclipUpdateMyProfile forwards the patch body", async () => {
    const captured: Array<unknown> = [];
    const client = mockClient({
      "PATCH /me/profile": (body) => {
        captured.push(body);
        return { ...body, userId: "user_1", updatedAt: "2026-04-18T00:01:00.000Z" };
      },
    });
    const tool = getTool(client, "paperclipUpdateMyProfile");
    await tool.handler({ claudeSubscription: "max", codexSubscription: "max" });
    expect(captured[0]).toEqual({ claudeSubscription: "max", codexSubscription: "max" });
  });
});
```

(`mockClient` and `getTool` helpers already exist in `tools.test.ts`; match their established usage patterns from the existing `paperclipHireWithProfile` tests.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @paperclipai/mcp-server test:run src/tools.test.ts -t "operator profile tools"`
Expected: FAIL — tools not defined.

- [ ] **Step 3: Add the tools**

Modify `packages/mcp-server/src/tools.ts`.

First, add to the existing `@paperclipai/shared` import at the top of the file:

```ts
import { ..., updateUserProfileSchema } from "@paperclipai/shared";
```

(Find the existing import line — it already pulls several things from `@paperclipai/shared`; just add `updateUserProfileSchema` to the list.)

Then find the `TOOL_ANNOTATIONS` map (around line 232) and add:

```ts
paperclipGetMyProfile: { ...READ_ONLY, title: "Operator profile" },
paperclipUpdateMyProfile: { ...SAFE_WRITE, title: "Update operator profile" },
```

Then in `createToolDefinitions`, find the block where `paperclipMe` is defined and add after it:

```ts
makeTool(
  "paperclipGetMyProfile",
  "Return the operator's profile (subscription declarations + preferences). Every caller operating as a board user has one — auto-created with safe defaults (subscriptionOnly=true) on first access.",
  z.object({}),
  async () => client.getMyProfile(),
),
makeTool(
  "paperclipUpdateMyProfile",
  "Update the operator's profile. Pass any subset of { subscriptionOnly, claudeSubscription, codexSubscription, preferences }. Subscription plans: max, pro, plus, api, none. Set a subscription field to null to clear it.",
  updateUserProfileSchema,
  async (input) => client.updateMyProfile(input),
),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @paperclipai/mcp-server test:run src/tools.test.ts -t "operator profile tools"`
Expected: PASS — both cases.

- [ ] **Step 5: Commit**

```bash
git add packages/mcp-server/src/tools.ts packages/mcp-server/src/tools.test.ts
git commit -m "feat(#17): paperclipGetMyProfile + paperclipUpdateMyProfile MCP tools"
```

---

## Task 9: MCP resource `paperclip://me/profile`

**Files:**
- Modify: `packages/mcp-server/src/resources.ts`

- [ ] **Step 1: Add the resource**

Modify `packages/mcp-server/src/resources.ts`. Find where `paperclip://hiring-playbook` is defined (around line 120). Add a new resource entry alongside it:

```ts
{
  uri: "paperclip://me/profile",
  name: "Operator profile",
  description: "Current operator's subscription declarations and preferences. Use this as the primary signal for picking adapter defaults — if the operator is on subscription-only mode, prefer claude_local and codex_local over API-billed adapters.",
  mimeType: "application/json",
  read: async () => {
    const profile = await client.getMyProfile();
    return JSON.stringify(profile, null, 2);
  },
},
```

(Exact surrounding shape mirrors the existing hiring-playbook resource.)

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @paperclipai/mcp-server typecheck`
Expected: no errors.

- [ ] **Step 3: Smoke check — read the resource from a running MCP**

Rebuild MCP: `pnpm --filter @paperclipai/mcp-server build`.

Restart your Claude Code session so the updated MCP loads. Then in Claude: `read paperclip://me/profile`.
Expected: JSON containing `subscriptionOnly: true` + whatever subscription fields are set.

- [ ] **Step 4: Commit**

```bash
git add packages/mcp-server/src/resources.ts
git commit -m "feat(#17): paperclip://me/profile MCP resource"
```

---

## Task 10: Integration test — service end-to-end + routes

**Files:**
- Create: `server/src/__tests__/user-profiles.test.ts`

- [ ] **Step 1: Write the integration test**

Create `server/src/__tests__/user-profiles.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, closeTestDb } from "./helpers/db.js"; // existing test-DB helper
import { userProfileService } from "../services/user-profiles.js";

describe("userProfileService", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeEach(async () => { db = await createTestDb(); });

  it("auto-creates a profile with subscriptionOnly=true on first read", async () => {
    const svc = userProfileService(db);
    const profile = await svc.getProfile("user_alpha");
    expect(profile.userId).toBe("user_alpha");
    expect(profile.subscriptionOnly).toBe(true);
    expect(profile.claudeSubscription).toBeNull();
    expect(profile.codexSubscription).toBeNull();
    expect(profile.preferences).toEqual({});
    expect(profile.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    await closeTestDb(db);
  });

  it("round-trips updates to all fields", async () => {
    const svc = userProfileService(db);
    await svc.getProfile("user_beta"); // seed

    const updated = await svc.updateProfile("user_beta", {
      subscriptionOnly: false,
      claudeSubscription: "max",
      codexSubscription: "max",
      preferences: { theme: "dark" },
    });

    expect(updated.subscriptionOnly).toBe(false);
    expect(updated.claudeSubscription).toBe("max");
    expect(updated.codexSubscription).toBe("max");
    expect(updated.preferences).toEqual({ theme: "dark" });

    // Re-read confirms persistence.
    const reread = await svc.getProfile("user_beta");
    expect(reread).toEqual(updated);
    await closeTestDb(db);
  });

  it("allows null to clear a subscription", async () => {
    const svc = userProfileService(db);
    await svc.updateProfile("user_gamma", { claudeSubscription: "max" });
    const cleared = await svc.updateProfile("user_gamma", { claudeSubscription: null });
    expect(cleared.claudeSubscription).toBeNull();
    await closeTestDb(db);
  });

  it("isolates profiles per user", async () => {
    const svc = userProfileService(db);
    await svc.updateProfile("user_a", { subscriptionOnly: false });
    const b = await svc.getProfile("user_b");
    expect(b.subscriptionOnly).toBe(true); // default — not contaminated
    await closeTestDb(db);
  });
});
```

**Note on the test DB helper:** the exact name of the helper (`createTestDb`/`closeTestDb`) depends on what's already in `server/src/__tests__/helpers/`. Before writing the test, list the helpers:

```bash
ls server/src/__tests__/helpers/ 2>&1
```

Match the established pattern. If the repo uses a different test-DB convention (e.g. `withDb(async (db) => {...})`), mirror that instead — DO NOT invent a new one.

- [ ] **Step 2: Run test to verify it passes**

Run: `pnpm --filter @paperclipai/server test:run src/__tests__/user-profiles.test.ts`
Expected: PASS — all 4 cases.

- [ ] **Step 3: Run the full server test suite**

Run: `pnpm --filter @paperclipai/server test:run`
Expected: PASS — no regressions from the migration or service addition.

- [ ] **Step 4: Commit**

```bash
git add server/src/__tests__/user-profiles.test.ts
git commit -m "test(#17): user-profile service integration tests"
```

---

## Task 11: Whole-repo verification

**Files:** none modified in this task.

- [ ] **Step 1: Typecheck the whole repo**

Run: `pnpm typecheck`
Expected: 0 errors.

- [ ] **Step 2: Run all tests**

Run: `pnpm test:run`
Expected: all packages pass; no regressions.

- [ ] **Step 3: Rebuild the MCP server**

Run: `pnpm --filter @paperclipai/mcp-server build`
Expected: clean build.

- [ ] **Step 4: Manual end-to-end smoke**

With paperclip running (`pnpm dev` on `:3100`), restart your Claude Code session so the MCP reloads.

In Claude, run these four probes in order:

1. `paperclipGetMyProfile()` — expect default profile (`subscriptionOnly=true`, others null/empty).
2. `paperclipUpdateMyProfile({ claudeSubscription: "max", codexSubscription: "max" })` — expect the updated profile returned.
3. `paperclipGetMyProfile()` again — expect the two `max` fields persisted.
4. Read the resource `paperclip://me/profile` — expect the same JSON.

If all four succeed, F1 is functionally complete.

- [ ] **Step 5: Final commit (if any cleanup needed)**

If typecheck/tests surfaced any last-mile fixes, commit them:

```bash
git add -A
git commit -m "chore(#17): cleanup + verification pass"
```

Otherwise skip this step.

---

## Task 12: Close the GitHub issue

**Files:** none.

- [ ] **Step 1: Push the branch**

Run:
```bash
git push -u origin fix/F1-operator-profile
```

- [ ] **Step 2: Open a PR and reference the issue**

Run:
```bash
gh pr create --repo NoobyGains/paperclip \
  --title "feat(initiative-self-teaching): F1 — operator profile + subscriptionOnly" \
  --body "$(cat <<'EOF'
## Summary

Implements F1 of the self-teaching-paperclip initiative.

- New `user_profiles` table (migration 0063) keyed by `authUsers.id`.
- Auto-creates on first read with `subscriptionOnly=true` as the safe default.
- `GET` / `PATCH /api/me/profile` routes.
- MCP tools `paperclipGetMyProfile` + `paperclipUpdateMyProfile`.
- MCP resource `paperclip://me/profile`.

Closes #17.

Downstream: unblocks #20 (P1 enforcement), #21 (P2 recipe), #23 (P4 explainable descriptions), and (transitively) #26 (O2 onboard).

## Test plan

- [ ] `pnpm typecheck` clean.
- [ ] `pnpm test:run` clean.
- [ ] `paperclipGetMyProfile()` from a fresh Claude session returns defaults.
- [ ] `paperclipUpdateMyProfile({ claudeSubscription: "max" })` round-trips.
- [ ] Resource `paperclip://me/profile` reflects live state.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 2: Confirm the PR lands green in CI and merge when ready.**

---

## Verification

After all 12 tasks are complete, this ships:

- [ ] `user_profiles` table exists with correct schema + defaults.
- [ ] `GET /api/me/profile` returns defaults on first call; PATCH round-trips every field.
- [ ] `paperclipGetMyProfile` + `paperclipUpdateMyProfile` MCP tools work from a Claude session.
- [ ] `paperclip://me/profile` MCP resource renders live profile JSON.
- [ ] 4+ passing integration tests in `server/src/__tests__/user-profiles.test.ts`.
- [ ] 4 passing MCP-tool tests in `packages/mcp-server/src/tools.test.ts`.
- [ ] 4 passing validator tests in `packages/shared/src/__tests__/user-profile-validator.test.ts`.
- [ ] GitHub issue #17 closed via merged PR on `fix/F1-operator-profile`.
- [ ] `git log` shows ~10-12 small commits (one per task step that modified code), not one mega-commit.

Downstream issues unblocked: #20, #21, #23 can start immediately against `master`. #26 still waits on #19 + #24 before it can start.
