import { z } from "zod";
import { projectArchetypeStackSchema, type ProjectArchetypeStack } from "./types/project-archetype.js";

// ---------------------------------------------------------------------------
// Role entry schema
// ---------------------------------------------------------------------------

export const teamRoleEntrySchema = z.object({
  /** The role string — must be a valid AgentRole value (cto, engineer, qa, reviewer, etc.). */
  role: z.string().min(1),
  /**
   * Optional human-readable name for the slot. When absent the caller should
   * derive a label from the role (e.g. "Engineer").
   */
  name: z.string().optional(),
  /**
   * The hiring-profile ID to use when creating this agent slot.
   * Must be one of the seven profiles from hiring-profiles.ts:
   * coding-heavy, coding-standard, coding-light,
   * reasoning-heavy, reasoning-standard, reviewer, research.
   */
  profile: z.enum([
    "coding-heavy",
    "coding-standard",
    "coding-light",
    "reasoning-heavy",
    "reasoning-standard",
    "reviewer",
    "research",
  ]),
});

export type TeamRoleEntry = z.infer<typeof teamRoleEntrySchema>;

// ---------------------------------------------------------------------------
// Team shape schema
// ---------------------------------------------------------------------------

export const teamShapeSchema = z.object({
  roles: z.array(teamRoleEntrySchema).min(1),
});

export type TeamShape = z.infer<typeof teamShapeSchema>;

// ---------------------------------------------------------------------------
// Registry — one entry per archetype stack variant
// ---------------------------------------------------------------------------

export const TEAM_SHAPES: Record<ProjectArchetypeStack, TeamShape> = {
  "pnpm-monorepo": {
    roles: [
      { role: "cto", profile: "reasoning-standard" },
      { role: "engineer", name: "Backend Engineer", profile: "coding-standard" },
      { role: "engineer", name: "Frontend Engineer", profile: "coding-standard" },
      { role: "qa", profile: "reasoning-standard" },
      { role: "reviewer", profile: "reviewer" },
    ],
  },
  "npm-single": {
    roles: [
      { role: "engineer", name: "Engineer", profile: "coding-standard" },
      { role: "reviewer", profile: "reviewer" },
    ],
  },
  "python-poetry": {
    roles: [
      { role: "engineer", name: "Backend Engineer", profile: "coding-standard" },
      { role: "qa", profile: "reasoning-standard" },
      { role: "reviewer", profile: "reviewer" },
    ],
  },
  "rust-cargo": {
    roles: [
      { role: "engineer", name: "Senior Engineer", profile: "coding-heavy" },
      { role: "reviewer", profile: "reviewer" },
    ],
  },
  "go-modules": {
    roles: [
      { role: "engineer", name: "Backend Engineer", profile: "coding-standard" },
      { role: "reviewer", profile: "reviewer" },
    ],
  },
  dotnet: {
    roles: [
      { role: "engineer", name: "Backend Engineer", profile: "coding-standard" },
      { role: "qa", profile: "reasoning-standard" },
      { role: "reviewer", profile: "reviewer" },
    ],
  },
  unknown: {
    roles: [
      { role: "engineer", profile: "coding-standard" },
      { role: "reviewer", profile: "reviewer" },
    ],
  },
};

// ---------------------------------------------------------------------------
// Accessors
// ---------------------------------------------------------------------------

/**
 * Return the team shape for a given archetype stack, falling back to the
 * "unknown" shape if the key is not in the registry (should never happen
 * in practice given the exhaustive map above).
 */
export function getTeamShape(stack: string): TeamShape {
  return (
    (TEAM_SHAPES as Record<string, TeamShape>)[stack] ?? TEAM_SHAPES["unknown"]
  );
}

/**
 * Return the full registry as an array of { stack, shape } entries.
 */
export function listTeamShapes(): Array<{ stack: ProjectArchetypeStack; shape: TeamShape }> {
  return (Object.keys(TEAM_SHAPES) as ProjectArchetypeStack[]).map((stack) => ({
    stack,
    shape: TEAM_SHAPES[stack],
  }));
}

/** The schema that describes the full registry (used for runtime validation). */
export const teamShapeRegistrySchema = z.record(projectArchetypeStackSchema, teamShapeSchema);
export type TeamShapeRegistry = z.infer<typeof teamShapeRegistrySchema>;
