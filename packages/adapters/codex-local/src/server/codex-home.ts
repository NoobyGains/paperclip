import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AdapterExecutionContext } from "@paperclipai/adapter-utils";

const TRUTHY_ENV_RE = /^(1|true|yes|on)$/i;
const COPIED_SHARED_FILES = ["config.json", "config.toml", "instructions.md"] as const;
const SYMLINKED_SHARED_FILES = ["auth.json"] as const;
const DEFAULT_PAPERCLIP_INSTANCE_ID = "default";
const SANDBOX_WORKSPACE_WRITE_SECTION = "sandbox_workspace_write";
const SANDBOX_WORKSPACE_WRITE_NETWORK_ACCESS_LINE = "network_access = true";

function nonEmpty(value: string | undefined): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export async function pathExists(candidate: string): Promise<boolean> {
  return fs.access(candidate).then(() => true).catch(() => false);
}

export function resolveSharedCodexHomeDir(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const fromEnv = nonEmpty(env.CODEX_HOME);
  return fromEnv ? path.resolve(fromEnv) : path.join(os.homedir(), ".codex");
}

function isWorktreeMode(env: NodeJS.ProcessEnv): boolean {
  return TRUTHY_ENV_RE.test(env.PAPERCLIP_IN_WORKTREE ?? "");
}

export function resolveManagedCodexHomeDir(
  env: NodeJS.ProcessEnv,
  companyId?: string,
): string {
  const paperclipHome = nonEmpty(env.PAPERCLIP_HOME) ?? path.resolve(os.homedir(), ".paperclip");
  const instanceId = nonEmpty(env.PAPERCLIP_INSTANCE_ID) ?? DEFAULT_PAPERCLIP_INSTANCE_ID;
  return companyId
    ? path.resolve(paperclipHome, "instances", instanceId, "companies", companyId, "codex-home")
    : path.resolve(paperclipHome, "instances", instanceId, "codex-home");
}

async function ensureParentDir(target: string): Promise<void> {
  await fs.mkdir(path.dirname(target), { recursive: true });
}

async function ensureSymlink(target: string, source: string): Promise<void> {
  const existing = await fs.lstat(target).catch(() => null);
  if (!existing) {
    await ensureParentDir(target);
    await fs.symlink(source, target);
    return;
  }

  if (!existing.isSymbolicLink()) {
    return;
  }

  const linkedPath = await fs.readlink(target).catch(() => null);
  if (!linkedPath) return;

  const resolvedLinkedPath = path.resolve(path.dirname(target), linkedPath);
  if (resolvedLinkedPath === source) return;

  await fs.unlink(target);
  await fs.symlink(source, target);
}

async function ensureCopiedFile(target: string, source: string): Promise<void> {
  const existing = await fs.lstat(target).catch(() => null);
  if (existing) return;
  await ensureParentDir(target);
  await fs.copyFile(source, target);
}

function upsertWorkspaceWriteNetworkAccessToml(content: string): string {
  const normalized = content.replace(/\r\n/g, "\n");
  const lines = normalized.length > 0 ? normalized.split("\n") : [];
  const sectionHeader = `[${SANDBOX_WORKSPACE_WRITE_SECTION}]`;
  const sectionIndex = lines.findIndex((line) => line.trim() === sectionHeader);

  if (sectionIndex >= 0) {
    let nextSectionIndex = lines.length;
    for (let index = sectionIndex + 1; index < lines.length; index += 1) {
      if (/^\s*\[.+\]\s*$/.test(lines[index] ?? "")) {
        nextSectionIndex = index;
        break;
      }
    }

    const networkAccessIndex = lines.findIndex(
      (line, index) =>
        index > sectionIndex
        && index < nextSectionIndex
        && /^\s*network_access\s*=/.test(line),
    );

    if (networkAccessIndex >= 0) {
      lines[networkAccessIndex] = SANDBOX_WORKSPACE_WRITE_NETWORK_ACCESS_LINE;
    } else {
      lines.splice(sectionIndex + 1, 0, SANDBOX_WORKSPACE_WRITE_NETWORK_ACCESS_LINE);
    }
  } else {
    if (lines.length > 0 && lines[lines.length - 1] !== "") {
      lines.push("");
    }
    lines.push(sectionHeader, SANDBOX_WORKSPACE_WRITE_NETWORK_ACCESS_LINE);
  }

  const next = lines.join("\n");
  return next.endsWith("\n") ? next : `${next}\n`;
}

async function ensureWorkspaceWriteNetworkAccessConfig(
  targetHome: string,
  onLog: AdapterExecutionContext["onLog"],
): Promise<void> {
  const targetConfigPath = path.join(targetHome, "config.toml");
  const existingConfig = await fs.readFile(targetConfigPath, "utf8").catch(() => "");
  const nextConfig = upsertWorkspaceWriteNetworkAccessToml(existingConfig);
  if (nextConfig === existingConfig) return;
  await ensureParentDir(targetConfigPath);
  await fs.writeFile(targetConfigPath, nextConfig, "utf8");
  await onLog(
    "stdout",
    `[paperclip] Enabled sandbox_workspace_write.network_access in managed Codex config "${targetConfigPath}".\n`,
  );
}

export async function prepareManagedCodexHome(
  env: NodeJS.ProcessEnv,
  onLog: AdapterExecutionContext["onLog"],
  companyId?: string,
): Promise<string> {
  const targetHome = resolveManagedCodexHomeDir(env, companyId);

  const sourceHome = resolveSharedCodexHomeDir(env);
  if (path.resolve(sourceHome) === path.resolve(targetHome)) return targetHome;

  await fs.mkdir(targetHome, { recursive: true });

  for (const name of SYMLINKED_SHARED_FILES) {
    const source = path.join(sourceHome, name);
    if (!(await pathExists(source))) continue;
    await ensureSymlink(path.join(targetHome, name), source);
  }

  for (const name of COPIED_SHARED_FILES) {
    const source = path.join(sourceHome, name);
    if (!(await pathExists(source))) continue;
    await ensureCopiedFile(path.join(targetHome, name), source);
  }

  await ensureWorkspaceWriteNetworkAccessConfig(targetHome, onLog);

  await onLog(
    "stdout",
    `[paperclip] Using ${isWorktreeMode(env) ? "worktree-isolated" : "Paperclip-managed"} Codex home "${targetHome}" (seeded from "${sourceHome}").\n`,
  );
  return targetHome;
}
