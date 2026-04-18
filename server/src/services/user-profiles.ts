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
