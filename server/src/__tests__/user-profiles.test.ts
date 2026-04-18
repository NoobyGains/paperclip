import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { createDb, userProfiles } from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { userProfileService } from "../services/user-profiles.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

describeEmbeddedPostgres("userProfileService", () => {
  let db!: ReturnType<typeof createDb>;
  let svc!: ReturnType<typeof userProfileService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-user-profiles-");
    db = createDb(tempDb.connectionString);
    svc = userProfileService(db);
  }, 20_000);

  afterEach(async () => {
    await db.delete(userProfiles);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  it("auto-creates a profile with subscriptionOnly=true on first read", async () => {
    const profile = await svc.getProfile("user_alpha");

    expect(profile.userId).toBe("user_alpha");
    expect(profile.subscriptionOnly).toBe(true);
    expect(profile.claudeSubscription).toBeNull();
    expect(profile.codexSubscription).toBeNull();
    expect(profile.preferences).toEqual({});
    expect(new Date(profile.createdAt).toISOString()).toBe(profile.createdAt);
  });

  it("round-trips updates to all fields", async () => {
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

    const refetched = await svc.getProfile("user_beta");
    expect(refetched.subscriptionOnly).toBe(false);
    expect(refetched.claudeSubscription).toBe("max");
    expect(refetched.codexSubscription).toBe("max");
    expect(refetched.preferences).toEqual({ theme: "dark" });
  });

  it("allows null to clear a subscription", async () => {
    await svc.updateProfile("user_gamma", { claudeSubscription: "max" });
    const cleared = await svc.updateProfile("user_gamma", { claudeSubscription: null });

    expect(cleared.claudeSubscription).toBeNull();
  });

  it("isolates profiles per user", async () => {
    await svc.updateProfile("user_a", { subscriptionOnly: false });
    const userB = await svc.getProfile("user_b");

    expect(userB.subscriptionOnly).toBe(true);
  });
});
