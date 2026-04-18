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
