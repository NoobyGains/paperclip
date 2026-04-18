import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prepareManagedCodexHome, upsertWorkspaceWriteNetworkAccessToml } from "./codex-home.js";

describe("upsertWorkspaceWriteNetworkAccessToml", () => {
  it("appends the sandbox_workspace_write section with network_access=true when missing (enabled)", () => {
    const next = upsertWorkspaceWriteNetworkAccessToml(
      'model = "codex-mini-latest"\n',
      true,
    );
    expect(next).toBe(
      'model = "codex-mini-latest"\n\n[sandbox_workspace_write]\nnetwork_access = true\n',
    );
  });

  it("appends the sandbox_workspace_write section with network_access=false when missing (disabled)", () => {
    const next = upsertWorkspaceWriteNetworkAccessToml(
      'model = "codex-mini-latest"\n',
      false,
    );
    expect(next).toBe(
      'model = "codex-mini-latest"\n\n[sandbox_workspace_write]\nnetwork_access = false\n',
    );
  });

  it("overwrites an existing network_access=true entry when switching to disabled", () => {
    const original = 'model = "codex-mini-latest"\n\n[sandbox_workspace_write]\nnetwork_access = true\n';
    const next = upsertWorkspaceWriteNetworkAccessToml(original, false);
    expect(next).toBe(
      'model = "codex-mini-latest"\n\n[sandbox_workspace_write]\nnetwork_access = false\n',
    );
  });

  it("overwrites an existing network_access=false entry when switching to enabled", () => {
    const original = 'model = "codex-mini-latest"\n\n[sandbox_workspace_write]\nnetwork_access = false\n';
    const next = upsertWorkspaceWriteNetworkAccessToml(original, true);
    expect(next).toBe(
      'model = "codex-mini-latest"\n\n[sandbox_workspace_write]\nnetwork_access = true\n',
    );
  });

  it("is idempotent when the desired value already matches", () => {
    const original = 'model = "codex-mini-latest"\n\n[sandbox_workspace_write]\nnetwork_access = true\n';
    const next = upsertWorkspaceWriteNetworkAccessToml(original, true);
    expect(next).toBe(original);
  });

  it("inserts a new network_access line within an existing section that lacks one", () => {
    const original =
      'model = "codex-mini-latest"\n\n[sandbox_workspace_write]\nwritable_roots = ["/workspace"]\n';
    const next = upsertWorkspaceWriteNetworkAccessToml(original, false);
    expect(next).toBe(
      'model = "codex-mini-latest"\n\n[sandbox_workspace_write]\nnetwork_access = false\nwritable_roots = ["/workspace"]\n',
    );
  });

  it("does not disturb unrelated sections that appear after sandbox_workspace_write", () => {
    const original =
      '[sandbox_workspace_write]\nnetwork_access = true\n\n[profiles.default]\nmodel = "codex-mini"\n';
    const next = upsertWorkspaceWriteNetworkAccessToml(original, false);
    expect(next).toBe(
      '[sandbox_workspace_write]\nnetwork_access = false\n\n[profiles.default]\nmodel = "codex-mini"\n',
    );
  });
});

describe("prepareManagedCodexHome", () => {
  let root: string;
  let sharedCodexHome: string;
  let paperclipHome: string;
  let env: NodeJS.ProcessEnv;
  const companyId = "company-loopback-toggle";

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-codex-home-test-"));
    sharedCodexHome = path.join(root, "shared-codex-home");
    paperclipHome = path.join(root, "paperclip-home");
    await fs.mkdir(sharedCodexHome, { recursive: true });
    await fs.writeFile(
      path.join(sharedCodexHome, "config.toml"),
      'model = "codex-mini-latest"\n',
      "utf8",
    );
    env = {
      CODEX_HOME: sharedCodexHome,
      PAPERCLIP_HOME: paperclipHome,
      PAPERCLIP_INSTANCE_ID: "test-instance",
    };
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("writes sandbox_workspace_write.network_access = true by default", async () => {
    const logs: string[] = [];
    const home = await prepareManagedCodexHome(
      env,
      async (_stream, chunk) => {
        logs.push(chunk);
      },
      companyId,
    );
    const configPath = path.join(home, "config.toml");
    const config = await fs.readFile(configPath, "utf8");
    expect(config).toBe(
      'model = "codex-mini-latest"\n\n[sandbox_workspace_write]\nnetwork_access = true\n',
    );
    expect(logs.some((chunk) => chunk.includes("Enabled sandbox_workspace_write.network_access"))).toBe(true);
  });

  it("writes sandbox_workspace_write.network_access = false when the company setting is off", async () => {
    const logs: string[] = [];
    const home = await prepareManagedCodexHome(
      env,
      async (_stream, chunk) => {
        logs.push(chunk);
      },
      companyId,
      { sandboxLoopbackEnabled: false },
    );
    const configPath = path.join(home, "config.toml");
    const config = await fs.readFile(configPath, "utf8");
    expect(config).toBe(
      'model = "codex-mini-latest"\n\n[sandbox_workspace_write]\nnetwork_access = false\n',
    );
    expect(logs.some((chunk) => chunk.includes("Disabled sandbox_workspace_write.network_access"))).toBe(true);
  });

  it("updates an existing managed config from disabled back to enabled when the company setting flips on", async () => {
    await prepareManagedCodexHome(
      env,
      async () => {},
      companyId,
      { sandboxLoopbackEnabled: false },
    );
    const home = await prepareManagedCodexHome(
      env,
      async () => {},
      companyId,
      { sandboxLoopbackEnabled: true },
    );
    const configPath = path.join(home, "config.toml");
    const config = await fs.readFile(configPath, "utf8");
    expect(config).toBe(
      'model = "codex-mini-latest"\n\n[sandbox_workspace_write]\nnetwork_access = true\n',
    );
  });
});
