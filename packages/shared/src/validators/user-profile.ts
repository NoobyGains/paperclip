import { z } from "zod";
import { subscriptionPlanSchema } from "../types/user-profile.js";

export const updateUserProfileSchema = z.object({
  subscriptionOnly: z.boolean().optional(),
  claudeSubscription: subscriptionPlanSchema.nullable().optional(),
  codexSubscription: subscriptionPlanSchema.nullable().optional(),
  preferences: z.record(z.unknown()).optional(),
}).strict();

export type UpdateUserProfileInput = z.infer<typeof updateUserProfileSchema>;
