import { z } from "zod";

export const projectArchetypeStackSchema = z.enum([
  "pnpm-monorepo",
  "npm-single",
  "python-poetry",
  "rust-cargo",
  "go-modules",
  "dotnet",
  "unknown",
]);

export type ProjectArchetypeStack = z.infer<typeof projectArchetypeStackSchema>;

export const projectArchetypeSchema = z.object({
  stack: projectArchetypeStackSchema,
  packageManager: z.string().optional(),
  testCommand: z.string().optional(),
  migrationCommand: z.string().optional(),
  lintCommand: z.string().optional(),
  buildCommand: z.string().optional(),
  archDocPath: z.string().optional(),
  existingClaudeMd: z.string().optional(),
  existingAgentsMd: z.string().optional(),
  workspaces: z.array(z.string()).optional(),
});

export type ProjectArchetype = z.infer<typeof projectArchetypeSchema>;
