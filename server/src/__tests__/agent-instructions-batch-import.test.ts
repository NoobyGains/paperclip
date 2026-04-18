/**
 * Regression tests for Fork Issue #3:
 * "GUI instructions tab is empty for batch-created claude_local agents."
 *
 * These tests exercise the real `materializeManagedBundle` pathway that
 * company-portability uses for batch agent import, then call the real
 * `getBundle` that the GUI `/instructions-bundle` route depends on.
 * Runtime read paths (promptCache/execute) use `instructionsFilePath`
 * directly, so they are not covered here.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { agentInstructionsService } from "../services/agent-instructions.js";

type TestAgent = {
  id: string;
  companyId: string;
  name: string;
  adapterConfig: Record<string, unknown>;
};

async function makeTempDir(prefix: string) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

function makeAgent(adapterConfig: Record<string, unknown> = {}): TestAgent {
  return {
    id: "agent-batch-1",
    companyId: "company-batch-1",
    name: "Batch Agent",
    adapterConfig,
  };
}

describe("agent instructions bundle for batch-imported agents", () => {
  const originalPaperclipHome = process.env.PAPERCLIP_HOME;
  const originalPaperclipInstanceId = process.env.PAPERCLIP_INSTANCE_ID;
  const cleanupDirs = new Set<string>();

  beforeEach(async () => {
    const paperclipHome = await makeTempDir("paperclip-batch-home-");
    cleanupDirs.add(paperclipHome);
    process.env.PAPERCLIP_HOME = paperclipHome;
    process.env.PAPERCLIP_INSTANCE_ID = "test-instance";
  });

  afterEach(async () => {
    if (originalPaperclipHome === undefined) delete process.env.PAPERCLIP_HOME;
    else process.env.PAPERCLIP_HOME = originalPaperclipHome;
    if (originalPaperclipInstanceId === undefined) delete process.env.PAPERCLIP_INSTANCE_ID;
    else process.env.PAPERCLIP_INSTANCE_ID = originalPaperclipInstanceId;

    await Promise.all([...cleanupDirs].map(async (dir) => {
      await fs.rm(dir, { recursive: true, force: true });
      cleanupDirs.delete(dir);
    }));
  });

  it("surfaces AGENTS.md through getBundle after batch materialization (single file)", async () => {
    const svc = agentInstructionsService();
    const agent = makeAgent();

    // Mirrors company-portability.ts batch import: bundleFiles["AGENTS.md"] is
    // the frontmatter-stripped body of the imported markdown.
    const materialized = await svc.materializeManagedBundle(
      agent,
      { "AGENTS.md": "# Imported ClaudeCoder\nYou are ClaudeCoder.\n" },
      { clearLegacyPromptTemplate: true, replaceExisting: true },
    );

    expect(materialized.adapterConfig).toMatchObject({
      instructionsBundleMode: "managed",
      instructionsEntryFile: "AGENTS.md",
    });
    expect(materialized.adapterConfig.instructionsFilePath).toEqual(
      path.join(materialized.adapterConfig.instructionsRootPath as string, "AGENTS.md"),
    );

    // Simulate a subsequent `GET /agents/:id/instructions-bundle` by
    // re-reading the bundle with the persisted adapter config.
    const persisted = makeAgent(materialized.adapterConfig);
    const bundle = await svc.getBundle(persisted);
    expect(bundle.mode).toBe("managed");
    expect(bundle.files.map((file) => file.path)).toEqual(["AGENTS.md"]);

    const detail = await svc.readFile(persisted, "AGENTS.md");
    expect(detail.content).toContain("You are ClaudeCoder.");
  });

  it("includes nested bundle files imported from the source package", async () => {
    const svc = agentInstructionsService();
    const agent = makeAgent();

    // A bundle imported from disk may carry sibling reference files alongside AGENTS.md.
    const materialized = await svc.materializeManagedBundle(
      agent,
      {
        "AGENTS.md": "# Imported\nYou are ClaudeCoder.\n",
        "docs/REFERENCE.md": "## Reference\n",
      },
      { clearLegacyPromptTemplate: true, replaceExisting: true },
    );

    const persisted = makeAgent(materialized.adapterConfig);
    const bundle = await svc.getBundle(persisted);
    expect(bundle.files.map((file) => file.path)).toEqual(["AGENTS.md", "docs/REFERENCE.md"]);

    const nested = await svc.readFile(persisted, "docs/REFERENCE.md");
    expect(nested.content).toBe("## Reference\n");
  });

  it("recovers the bundle when adapterConfig is stripped after materialization", async () => {
    // Scenario: batch import writes the managed root on disk, but a
    // subsequent persistence step (e.g. prepareImportedAgentAdapter strips
    // instructions* keys on import) can drop the bundle pointers.
    // The service should recover the managed bundle from the on-disk
    // directory so the GUI still shows the real content.
    const svc = agentInstructionsService();
    const agent = makeAgent();
    await svc.materializeManagedBundle(
      agent,
      { "AGENTS.md": "# Recovered\nYou are ClaudeCoder.\n" },
      { clearLegacyPromptTemplate: true, replaceExisting: true },
    );

    const strippedAgent = makeAgent({});
    const bundle = await svc.getBundle(strippedAgent);
    expect(bundle.mode).toBe("managed");
    expect(bundle.files.map((file) => file.path)).toEqual(["AGENTS.md"]);
    const detail = await svc.readFile(strippedAgent, "AGENTS.md");
    expect(detail.content).toContain("You are ClaudeCoder.");
  });

  it("does not return an empty bundle when batch import writes only a body to AGENTS.md", async () => {
    // Reproduces the case where parseFrontmatterMarkdown produces a body
    // that is just text (no frontmatter), which materializeManagedBundle
    // should still persist and expose through getBundle.
    const svc = agentInstructionsService();
    const agent = makeAgent();
    const body = "# Plain body\nThis agent behaves like X, Y, Z.\n";
    const materialized = await svc.materializeManagedBundle(
      agent,
      { "AGENTS.md": body },
      { clearLegacyPromptTemplate: true, replaceExisting: true },
    );

    const persisted = makeAgent(materialized.adapterConfig);
    const bundle = await svc.getBundle(persisted);
    expect(bundle.files.length).toBeGreaterThan(0);
    const detail = await svc.readFile(persisted, "AGENTS.md");
    expect(detail.content).toBe(body);
  });
});
