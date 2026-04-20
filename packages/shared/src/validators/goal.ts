import { z } from "zod";
import { GOAL_LEVELS, GOAL_SCOPES, GOAL_STATUSES } from "../constants.js";

export const createGoalSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional().nullable(),
  /**
   * Hierarchy position. Accepts legacy `company|team|agent|task` scope-style
   * values and the OKR-style `objective|key_result` values (#83). New
   * callers should prefer `objective`/`key_result`; use `scope` for
   * ownership.
   */
  level: z.enum(GOAL_LEVELS).optional().default("task"),
  /**
   * Ownership / reach. Orthogonal to `level` (#83). Optional; when omitted,
   * the legacy `level` value still carries ownership information for
   * backward compatibility.
   */
  scope: z.enum(GOAL_SCOPES).optional(),
  status: z.enum(GOAL_STATUSES).optional().default("planned"),
  parentId: z.string().uuid().optional().nullable(),
  ownerAgentId: z.string().uuid().optional().nullable(),
});

export type CreateGoal = z.infer<typeof createGoalSchema>;

export const updateGoalSchema = createGoalSchema.partial();

export type UpdateGoal = z.infer<typeof updateGoalSchema>;
