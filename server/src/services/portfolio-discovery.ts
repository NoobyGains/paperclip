/**
 * Portfolio discovery service — local filesystem + GitHub repo scanning.
 *
 * Local scan: one level deep under rootPath, looking for directories that
 * contain a `.git/` subdirectory.  For each hit we attempt to read the git
 * remote URL from `.git/config` and the project name from `package.json`.
 *
 * GitHub scan: fetches the repo list for an owner via the GitHub REST API.
 * Only one request is made per scan.
 *
 * Deduplication is performed by normalising git remote URLs so that SSH and
 * HTTPS variants of the same repo compare equal.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LocalProject {
  name: string;
  repoPath: string;
  remote?: string;
}

export interface GitHubRepo {
  name: string;
  owner: string;
  url: string;
  description?: string;
}

export interface DiscoveryResult {
  local: LocalProject[];
  github: GitHubRepo[];
  dedupedTotal: number;
  /** Set when the local scan failed (e.g. invalid rootPath). */
  localError?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function readGitRemoteUrl(gitConfigPath: string): Promise<string | undefined> {
  let text: string;
  try {
    text = await fs.readFile(gitConfigPath, "utf8");
  } catch {
    return undefined;
  }

  const lines = text.split(/\r?\n/);
  let inOrigin = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith("[")) {
      inOrigin = /^\[remote\s+"origin"\]/.test(line);
      continue;
    }
    if (inOrigin) {
      const m = line.match(/^url\s*=\s*(.+)$/);
      if (m) return m[1]?.trim();
    }
  }
  return undefined;
}

async function readPackageJsonName(pkgPath: string): Promise<string | undefined> {
  try {
    const text = await fs.readFile(pkgPath, "utf8");
    const parsed = JSON.parse(text) as Record<string, unknown>;
    if (typeof parsed.name === "string" && parsed.name.length > 0) {
      return parsed.name;
    }
  } catch {
    // ignore
  }
  return undefined;
}

/**
 * Normalise a git remote URL so that SSH and HTTPS variants compare equal.
 *   git@github.com:owner/repo.git  → github.com/owner/repo
 *   https://github.com/owner/repo   → github.com/owner/repo
 */
export function normaliseRemoteUrl(url: string): string {
  const trimmed = url.trim();

  const sshMatch = trimmed.match(/^git@([^:]+):(.+?)(?:\.git)?$/);
  if (sshMatch) {
    return `${sshMatch[1]!.toLowerCase()}/${sshMatch[2]!}`;
  }

  try {
    const u = new URL(trimmed.replace(/\.git$/, ""));
    return `${u.hostname.toLowerCase()}${u.pathname}`;
  } catch {
    return trimmed.toLowerCase().replace(/\.git$/, "");
  }
}

// ---------------------------------------------------------------------------
// Local scan
// ---------------------------------------------------------------------------

export async function scanLocalProjects(rootPath: string): Promise<LocalProject[]> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(rootPath, { withFileTypes: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Cannot read rootPath "${rootPath}": ${message}`);
  }

  const projects: LocalProject[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const dirPath = path.join(rootPath, entry.name);
    const gitDir = path.join(dirPath, ".git");

    let isGitRepo = false;
    try {
      const stat = await fs.stat(gitDir);
      isGitRepo = stat.isDirectory();
    } catch {
      continue;
    }

    if (!isGitRepo) continue;

    const remote = await readGitRemoteUrl(path.join(gitDir, "config"));
    const pkgName = await readPackageJsonName(path.join(dirPath, "package.json"));

    projects.push({
      name: pkgName ?? entry.name,
      repoPath: dirPath,
      ...(remote !== undefined ? { remote } : {}),
    });
  }

  return projects;
}

// ---------------------------------------------------------------------------
// GitHub scan
// ---------------------------------------------------------------------------

export interface GitHubScanOptions {
  owner: string;
  fetchFn?: typeof fetch;
}

export async function scanGitHubRepos(options: GitHubScanOptions): Promise<GitHubRepo[]> {
  const { owner, fetchFn = fetch } = options;
  const url = `https://api.github.com/users/${encodeURIComponent(owner)}/repos?per_page=100&sort=updated`;

  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const token = process.env.GITHUB_TOKEN;
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const response = await fetchFn(url, { headers });
  if (!response.ok) {
    throw new Error(`GitHub API error ${response.status}: ${await response.text()}`);
  }

  const data = (await response.json()) as Array<Record<string, unknown>>;
  if (!Array.isArray(data)) {
    throw new Error("GitHub API returned unexpected payload");
  }

  return data.map((repo) => ({
    name: String(repo.name ?? ""),
    owner: String((repo.owner as Record<string, unknown>)?.login ?? owner),
    url: String(repo.html_url ?? ""),
    ...(typeof repo.description === "string" && repo.description
      ? { description: repo.description }
      : {}),
  }));
}

// ---------------------------------------------------------------------------
// Discover (combined + dedup)
// ---------------------------------------------------------------------------

export interface DiscoverProjectsOptions {
  rootPath?: string;
  github?: {
    owner: string;
    fetchFn?: typeof fetch;
  };
}

export async function discoverProjects(
  options: DiscoverProjectsOptions = {},
): Promise<DiscoveryResult> {
  const rootPath = options.rootPath ?? path.dirname(process.cwd());

  let localError: string | undefined;
  const [localOrError, github] = await Promise.all([
    scanLocalProjects(rootPath).catch((err: unknown) => {
      localError = err instanceof Error ? err.message : String(err);
      return [] as LocalProject[];
    }),
    options.github
      ? scanGitHubRepos(options.github).catch(() => [] as GitHubRepo[])
      : Promise.resolve([] as GitHubRepo[]),
  ]);

  const localProjects: LocalProject[] = localOrError;
  const localRemoteSet = new Set<string>(
    localProjects.flatMap((p) => (p.remote ? [normaliseRemoteUrl(p.remote)] : [])),
  );

  const githubRepos: GitHubRepo[] = (github as GitHubRepo[]).filter((r) => {
    return !localRemoteSet.has(normaliseRemoteUrl(r.url));
  });

  return {
    local: localProjects,
    github: githubRepos,
    dedupedTotal: localProjects.length + githubRepos.length,
    ...(localError !== undefined ? { localError } : {}),
  };
}
