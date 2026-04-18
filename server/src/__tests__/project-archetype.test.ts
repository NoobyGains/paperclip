import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { detectArchetype } from "../services/project-archetype.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureRoot = path.resolve(__dirname, "../../../tests/fixtures/archetype");

describe("detectArchetype", () => {
  it("detects pnpm-monorepo", async () => {
    const archetype = await detectArchetype(path.join(fixtureRoot, "pnpm-monorepo"));
    expect(archetype.stack).toBe("pnpm-monorepo");
    expect(archetype.packageManager).toBe("pnpm");
    expect(archetype.testCommand).toBe("pnpm test");
    expect(archetype.migrationCommand).toBe("pnpm db:migrate");
    expect(archetype.workspaces).toEqual(["packages/*", "server"]);
  });

  it("detects npm-single", async () => {
    const archetype = await detectArchetype(path.join(fixtureRoot, "npm-single"));
    expect(archetype.stack).toBe("npm-single");
    expect(archetype.testCommand).toBeDefined();
    expect(archetype.buildCommand).toBeDefined();
    expect(archetype.lintCommand).toBeDefined();
  });

  it("detects python-poetry", async () => {
    const archetype = await detectArchetype(path.join(fixtureRoot, "python-poetry"));
    expect(archetype.stack).toBe("python-poetry");
    expect(archetype.packageManager).toBe("poetry");
    expect(archetype.testCommand).toBe("poetry run pytest");
  });

  it("detects rust-cargo", async () => {
    const archetype = await detectArchetype(path.join(fixtureRoot, "rust-cargo"));
    expect(archetype.stack).toBe("rust-cargo");
    expect(archetype.packageManager).toBe("cargo");
    expect(archetype.testCommand).toBe("cargo test");
    expect(archetype.buildCommand).toBe("cargo build --release");
  });

  it("detects go-modules", async () => {
    const archetype = await detectArchetype(path.join(fixtureRoot, "go-modules"));
    expect(archetype.stack).toBe("go-modules");
    expect(archetype.packageManager).toBe("go");
    expect(archetype.testCommand).toBe("go test ./...");
  });

  it("detects dotnet", async () => {
    const archetype = await detectArchetype(path.join(fixtureRoot, "dotnet"));
    expect(archetype.stack).toBe("dotnet");
    expect(archetype.packageManager).toBe("dotnet");
    expect(archetype.testCommand).toBe("dotnet test");
    expect(archetype.buildCommand).toBe("dotnet build");
  });

  it("returns { stack: unknown } for an unrecognized repo", async () => {
    const archetype = await detectArchetype(path.join(fixtureRoot, "unknown"));
    expect(archetype).toEqual({ stack: "unknown" });
  });
});
