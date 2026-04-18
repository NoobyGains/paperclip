import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readCeoOverlayFile, writeCeoOverlayFiles } from "../services/ceo-overlay.js";
import {
  loadDefaultAgentInstructionsBundle,
} from "../services/default-agent-instructions.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-ceo-overlay-test-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("readCeoOverlayFile", () => {
  it("returns null when file does not exist", async () => {
    const result = await readCeoOverlayFile(tmpDir, "AGENTS.md");
    expect(result).toBeNull();
  });

  it("returns file content when overlay exists", async () => {
    const overlayDir = path.join(tmpDir, ".paperclip", "ceo");
    await fs.mkdir(overlayDir, { recursive: true });
    await fs.writeFile(path.join(overlayDir, "AGENTS.md"), "# My Custom AGENTS", "utf8");

    const result = await readCeoOverlayFile(tmpDir, "AGENTS.md");
    expect(result).toBe("# My Custom AGENTS");
  });
});

describe("writeCeoOverlayFiles", () => {
  it("creates .paperclip/ceo/ directory and writes contents", async () => {
    const written = await writeCeoOverlayFiles(tmpDir, {
      "AGENTS.md": "# Custom AGENTS",
      "SOUL.md": "# Custom SOUL",
    });

    expect(written).toContain("AGENTS.md");
    expect(written).toContain("SOUL.md");
    expect(written).toHaveLength(2);

    const agentsContent = await fs.readFile(
      path.join(tmpDir, ".paperclip", "ceo", "AGENTS.md"),
      "utf8",
    );
    expect(agentsContent).toBe("# Custom AGENTS");

    const soulContent = await fs.readFile(
      path.join(tmpDir, ".paperclip", "ceo", "SOUL.md"),
      "utf8",
    );
    expect(soulContent).toBe("# Custom SOUL");
  });

  it("ignores non-overlay file names", async () => {
    const written = await writeCeoOverlayFiles(tmpDir, {
      "AGENTS.md": "# Good",
      "README.md": "should be ignored" as never,
    });

    expect(written).toEqual(["AGENTS.md"]);
  });
});

describe("loadDefaultAgentInstructionsBundle with overlay", () => {
  it("returns server default when no overlay present", async () => {
    const bundle = await loadDefaultAgentInstructionsBundle("ceo", {
      projectRepoPath: tmpDir,
    });

    expect(typeof bundle["AGENTS.md"]).toBe("string");
    expect(bundle["AGENTS.md"].length).toBeGreaterThan(0);
    expect(typeof bundle["HEARTBEAT.md"]).toBe("string");
    expect(typeof bundle["SOUL.md"]).toBe("string");
    expect(typeof bundle["TOOLS.md"]).toBe("string");
  });

  it("returns overlay content when overlay file is present", async () => {
    const overlayContent = "# PROJECT-SPECIFIC AGENTS OVERRIDE";
    await writeCeoOverlayFiles(tmpDir, { "AGENTS.md": overlayContent });

    const bundle = await loadDefaultAgentInstructionsBundle("ceo", {
      projectRepoPath: tmpDir,
    });

    expect(bundle["AGENTS.md"]).toBe(overlayContent);
    // Other files fall back to server defaults
    expect(bundle["HEARTBEAT.md"]).not.toBe(overlayContent);
    expect(bundle["HEARTBEAT.md"].length).toBeGreaterThan(0);
  });

  it("partial overlay — only overridden files replace defaults, others still come through", async () => {
    await writeCeoOverlayFiles(tmpDir, { "AGENTS.md": "# CUSTOM" });

    const bundle = await loadDefaultAgentInstructionsBundle("ceo", {
      projectRepoPath: tmpDir,
    });

    expect(bundle["AGENTS.md"]).toBe("# CUSTOM");
    // Remaining three default files still load
    expect(typeof bundle["HEARTBEAT.md"]).toBe("string");
    expect(bundle["HEARTBEAT.md"].length).toBeGreaterThan(0);
    expect(typeof bundle["SOUL.md"]).toBe("string");
    expect(bundle["SOUL.md"].length).toBeGreaterThan(0);
    expect(typeof bundle["TOOLS.md"]).toBe("string");
    expect(bundle["TOOLS.md"].length).toBeGreaterThan(0);
  });

  it("works without projectRepoPath (no overlay, loads defaults)", async () => {
    const bundle = await loadDefaultAgentInstructionsBundle("ceo");

    expect(typeof bundle["AGENTS.md"]).toBe("string");
    expect(bundle["AGENTS.md"].length).toBeGreaterThan(0);
  });
});
