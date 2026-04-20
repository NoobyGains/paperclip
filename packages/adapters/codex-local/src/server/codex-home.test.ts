import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

  // Regression guard for #60 — Windows without Developer Mode / admin can't
  // create symlinks. Before the fix, every codex worker errored on first wake
  // with EPERM. The fallback copies the file instead so the adapter stays
  // functional for non-privileged users.
  it("falls back to copying auth.json when fs.symlink throws EPERM (Windows without symlink privilege)", async () => {
    await fs.writeFile(path.join(sharedCodexHome, "auth.json"), '{"token":"shared"}', "utf8");

    const symlinkSpy = vi.spyOn(fs, "symlink").mockImplementation(async () => {
      const err = new Error("EPERM: operation not permitted") as NodeJS.ErrnoException;
      err.code = "EPERM";
      throw err;
    });

    try {
      const home = await prepareManagedCodexHome(env, async () => {}, companyId);
      const authPath = path.join(home, "auth.json");
      const authStat = await fs.lstat(authPath);
      expect(authStat.isSymbolicLink()).toBe(false);
      expect(authStat.isFile()).toBe(true);
      const authContent = await fs.readFile(authPath, "utf8");
      expect(authContent).toBe('{"token":"shared"}');
    } finally {
      symlinkSpy.mockRestore();
    }
  });

  it("refreshes the copied auth.json when the shared source is newer than the per-company copy", async () => {
    const sharedAuth = path.join(sharedCodexHome, "auth.json");
    await fs.writeFile(sharedAuth, '{"token":"v1"}', "utf8");

    const symlinkSpy = vi.spyOn(fs, "symlink").mockImplementation(async () => {
      const err = new Error("EPERM") as NodeJS.ErrnoException;
      err.code = "EPERM";
      throw err;
    });

    try {
      const home = await prepareManagedCodexHome(env, async () => {}, companyId);
      const copy = path.join(home, "auth.json");
      expect(await fs.readFile(copy, "utf8")).toBe('{"token":"v1"}');

      // Simulate the user refreshing their codex credentials: rewrite the
      // source with a newer mtime, then re-run. Copy should pick up the
      // change.
      await fs.writeFile(sharedAuth, '{"token":"v2"}', "utf8");
      const nowPlusOneSec = new Date(Date.now() + 1000);
      await fs.utimes(sharedAuth, nowPlusOneSec, nowPlusOneSec);

      await prepareManagedCodexHome(env, async () => {}, companyId);
      expect(await fs.readFile(copy, "utf8")).toBe('{"token":"v2"}');
    } finally {
      symlinkSpy.mockRestore();
    }
  });

  it("still throws non-permission errors from fs.symlink (doesn't silently swallow unrelated failures)", async () => {
    await fs.writeFile(path.join(sharedCodexHome, "auth.json"), '{"token":"shared"}', "utf8");

    const symlinkSpy = vi.spyOn(fs, "symlink").mockImplementation(async () => {
      const err = new Error("EIO: io error") as NodeJS.ErrnoException;
      err.code = "EIO";
      throw err;
    });

    try {
      await expect(prepareManagedCodexHome(env, async () => {}, companyId)).rejects.toThrow(/EIO/);
    } finally {
      symlinkSpy.mockRestore();
    }
  });
});
