import { describe, expect, it } from "vitest";
import { PLUGIN_CATALOG, type PluginCatalogEntry } from "./plugin-catalog.js";

// ---------------------------------------------------------------------------
// Schema validation helpers
// ---------------------------------------------------------------------------

const VALID_CATEGORIES = new Set([
  "notifications",
  "memory",
  "analytics",
  "integration",
  "runtime",
  "ui",
  "identity",
  "sync",
  "tools",
  "community",
]);

function validateEntry(entry: PluginCatalogEntry): string[] {
  const errors: string[] = [];
  if (!entry.id || typeof entry.id !== "string") errors.push("id must be a non-empty string");
  if (!entry.name || typeof entry.name !== "string") errors.push("name must be a non-empty string");
  if (!entry.description || typeof entry.description !== "string")
    errors.push("description must be a non-empty string");
  if (!entry.repo || !entry.repo.startsWith("https://github.com/"))
    errors.push(`repo must be a github URL, got: ${entry.repo}`);
  if (!VALID_CATEGORIES.has(entry.category))
    errors.push(`category '${entry.category}' is not a valid PluginCategory`);
  if (!Array.isArray(entry.tags) || entry.tags.length === 0)
    errors.push("tags must be a non-empty array");
  if (typeof entry.subscriptionCompatible !== "boolean")
    errors.push("subscriptionCompatible must be a boolean");
  if (!entry.installHint || typeof entry.installHint !== "string")
    errors.push("installHint must be a non-empty string");
  return errors;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("plugin catalog", () => {
  it("has at least 13 entries (spec minimum)", () => {
    expect(PLUGIN_CATALOG.length).toBeGreaterThanOrEqual(13);
  });

  it("contains all 13 plugin IDs listed in the spec", () => {
    const ids = new Set(PLUGIN_CATALOG.map((e) => e.id));
    const required = [
      "obsidian-paperclip",
      "paperclip-aperture",
      "paperclip-live-analytics-plugin",
      "paperclip-plugin-acp",
      "paperclip-plugin-avp",
      "paperclip-plugin-chat",
      "paperclip-plugin-company-wizard",
      "paperclip-plugin-discord",
      "paperclip-plugin-github-issues",
      "paperclip-plugin-slack",
      "paperclip-plugin-telegram",
      "paperclip-plugin-writbase",
      "paperclip-plugin-hindsight",
    ];
    for (const id of required) {
      expect(ids.has(id), `missing catalog entry: ${id}`).toBe(true);
    }
  });

  it("contains the tool entries from awesome-paperclip", () => {
    const ids = new Set(PLUGIN_CATALOG.map((e) => e.id));
    expect(ids.has("oh-my-paperclip")).toBe(true);
    expect(ids.has("paperclip-discord-bot")).toBe(true);
    expect(ids.has("paperclip-mcp")).toBe(true);
  });

  it("every entry passes schema validation", () => {
    for (const entry of PLUGIN_CATALOG) {
      const errors = validateEntry(entry);
      expect(errors, `${entry.id}: ${errors.join(", ")}`).toHaveLength(0);
    }
  });

  it("all entry IDs are unique", () => {
    const ids = PLUGIN_CATALOG.map((e) => e.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it("all entries have subscriptionCompatible=true (v1 catalog)", () => {
    // All v1 catalog entries are subscription-compatible since none require
    // direct API billing from the user.
    for (const entry of PLUGIN_CATALOG) {
      expect(entry.subscriptionCompatible, `${entry.id} should be subscription-compatible`).toBe(true);
    }
  });
});
