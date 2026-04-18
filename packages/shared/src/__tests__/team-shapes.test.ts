import { describe, it, expect } from "vitest";
import {
  TEAM_SHAPES,
  getTeamShape,
  listTeamShapes,
  teamShapeRegistrySchema,
} from "../team-shapes.js";
import { projectArchetypeStackSchema } from "../types/project-archetype.js";

const ALL_STACKS = projectArchetypeStackSchema.options;

describe("TEAM_SHAPES registry", () => {
  it("covers all 7 archetype stack variants", () => {
    expect(Object.keys(TEAM_SHAPES).sort()).toEqual([...ALL_STACKS].sort());
  });

  it("every shape has at least one role", () => {
    for (const [stack, shape] of Object.entries(TEAM_SHAPES)) {
      expect(shape.roles.length, `${stack} should have at least one role`).toBeGreaterThan(0);
    }
  });

  it("every role entry has a non-empty role string and valid profile id", () => {
    const validProfiles = new Set([
      "coding-heavy",
      "coding-standard",
      "coding-light",
      "reasoning-heavy",
      "reasoning-standard",
      "reviewer",
      "research",
    ]);
    for (const [stack, shape] of Object.entries(TEAM_SHAPES)) {
      for (const entry of shape.roles) {
        expect(entry.role.length, `${stack} role entry must have a non-empty role`).toBeGreaterThan(0);
        expect(
          validProfiles.has(entry.profile),
          `${stack} role "${entry.role}" has unknown profile "${entry.profile}"`,
        ).toBe(true);
      }
    }
  });

  it("validates against teamShapeRegistrySchema without errors", () => {
    const result = teamShapeRegistrySchema.safeParse(TEAM_SHAPES);
    expect(result.success).toBe(true);
  });
});

describe("getTeamShape", () => {
  it("returns correct shape for pnpm-monorepo", () => {
    const shape = getTeamShape("pnpm-monorepo");
    const roles = shape.roles.map((r) => r.role);
    expect(roles).toContain("cto");
    expect(roles).toContain("engineer");
    expect(roles).toContain("qa");
    expect(roles).toContain("reviewer");
    expect(shape.roles.filter((r) => r.role === "engineer")).toHaveLength(2);
  });

  it("returns correct shape for rust-cargo — Senior Engineer + reviewer", () => {
    const shape = getTeamShape("rust-cargo");
    expect(shape.roles).toHaveLength(2);
    const eng = shape.roles.find((r) => r.role === "engineer");
    expect(eng?.name).toBe("Senior Engineer");
    expect(eng?.profile).toBe("coding-heavy");
    const rev = shape.roles.find((r) => r.role === "reviewer");
    expect(rev?.profile).toBe("reviewer");
  });

  it("returns correct shape for unknown — minimal engineer + reviewer", () => {
    const shape = getTeamShape("unknown");
    expect(shape.roles).toHaveLength(2);
    const roles = shape.roles.map((r) => r.role);
    expect(roles).toContain("engineer");
    expect(roles).toContain("reviewer");
  });

  it("falls back to unknown shape for an unrecognised stack key", () => {
    const shape = getTeamShape("some-future-stack");
    // Falls back to the unknown preset
    expect(shape).toEqual(TEAM_SHAPES["unknown"]);
  });

  it.each(ALL_STACKS)("returns a non-empty shape for every known stack: %s", (stack) => {
    const shape = getTeamShape(stack);
    expect(shape.roles.length).toBeGreaterThan(0);
  });
});

describe("listTeamShapes", () => {
  it("returns one entry per archetype stack", () => {
    const list = listTeamShapes();
    expect(list).toHaveLength(ALL_STACKS.length);
  });

  it("each entry has a stack key and a shape with roles", () => {
    for (const { stack, shape } of listTeamShapes()) {
      expect(typeof stack).toBe("string");
      expect(Array.isArray(shape.roles)).toBe(true);
      expect(shape.roles.length).toBeGreaterThan(0);
    }
  });

  it("stack keys match the known archetype set", () => {
    const returned = listTeamShapes().map((e) => e.stack).sort();
    expect(returned).toEqual([...ALL_STACKS].sort());
  });
});
