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
