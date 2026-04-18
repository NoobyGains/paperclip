/**
 * Portfolio discovery — local filesystem + GitHub repo scanning.
 *
 * Local scan: one level deep under rootPath, looking for directories
 * that contain a `.git/` subdirectory.  For each hit we attempt to
 * read the git remote URL from `.git/config` and the project name
 * from `package.json`.
 *
 * GitHub scan: fetches the repo list for an owner via the GitHub REST
 * API.  Requires either the GITHUB_TOKEN env variable or an unauthenticated
 * request (60 req/h rate limit).  Only one request is made per scan.
 *
 * Deduplication is performed by normalising git remote URLs to a
 * canonical form (`git@github.com:owner/repo` and
 * `https://github.com/owner/repo` are treated as the same repo).
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

/**
 * Parse the first `url =` value under a `[remote "origin"]` stanza in a
 * git config file.  Returns undefined if the file cannot be read or parsed.
 */
async function readGitRemoteUrl(gitConfigPath: string): Promise<string | undefined> {
  let text: string;
  try {
    text = await fs.readFile(gitConfigPath, "utf8");
  } catch {
    return undefined;
  }

  // Very lightweight parser: find the [remote "origin"] section and grab url.
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

/**
 * Attempt to read the `name` field from a package.json.  Returns undefined
 * if the file is missing or malformed.
 */
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
 * Normalise a git remote URL to a canonical `owner/repo` pair so that
 * SSH and HTTPS variants of the same repo compare equal.
 *
 * Examples:
 *   git@github.com:owner/repo.git  → github.com/owner/repo
 *   https://github.com/owner/repo   → github.com/owner/repo
 *
 * For non-GitHub remotes the URL is lowercased and trailing `.git` stripped.
 */
export function normaliseRemoteUrl(url: string): string {
  const trimmed = url.trim();

  // SSH shorthand: git@host:path
  const sshMatch = trimmed.match(/^git@([^:]+):(.+?)(?:\.git)?$/);
  if (sshMatch) {
    return `${sshMatch[1]!.toLowerCase()}/${sshMatch[2]!}`;
  }

  // HTTPS / HTTP
  try {
    const u = new URL(trimmed.replace(/\.git$/, ""));
    return `${u.hostname.toLowerCase()}${u.pathname}`;
  } catch {
    // fall back to lowercase + strip .git
    return trimmed.toLowerCase().replace(/\.git$/, "");
  }
}

// ---------------------------------------------------------------------------
// Local scan
// ---------------------------------------------------------------------------

/**
 * Scan one level under rootPath for directories that contain a `.git/`
 * subdirectory.  Returns an array of LocalProject entries.
 *
 * Throws if rootPath does not exist or is not a directory.
 */
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
      // not a git repo
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
  /**
   * Override the fetch function — used in tests to avoid real HTTP calls.
   */
  fetchFn?: typeof fetch;
}

/**
 * List public (and private, if GITHUB_TOKEN is set) repos for an owner.
 * Only one request is made (up to 100 repos, which covers most portfolios).
 */
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
  /**
   * Root path to scan for local git repos (one level deep).
   * Defaults to the parent directory of the current working directory.
   */
  rootPath?: string;
  /**
   * If provided, also scan the given GitHub owner's repo list.
   */
  github?: {
    owner: string;
    fetchFn?: typeof fetch;
  };
}

export async function discoverProjects(
  options: DiscoverProjectsOptions = {},
): Promise<DiscoveryResult> {
  const rootPath =
    options.rootPath ??
    path.dirname(process.cwd());

  // Run local and GitHub scans in parallel (GitHub is independent).
  let localError: string | undefined;
  const [localOrError, github] = await Promise.all([
    scanLocalProjects(rootPath).catch((err: unknown) => {
      // Surface invalid rootPath gracefully — return empty + record error.
      localError = err instanceof Error ? err.message : String(err);
      return [] as LocalProject[];
    }),
    options.github
      ? scanGitHubRepos(options.github).catch(() => [] as GitHubRepo[])
      : Promise.resolve([] as GitHubRepo[]),
  ]);

  const localProjects: LocalProject[] = localOrError;

  // Dedup: build a set of normalised remote URLs from local projects,
  // then filter out GitHub repos whose URL matches any local remote.
  const localRemoteSet = new Set<string>(
    localProjects.flatMap((p) => (p.remote ? [normaliseRemoteUrl(p.remote)] : [])),
  );

  const githubRepos: GitHubRepo[] = (github as GitHubRepo[]).filter(
    (r) => !localRemoteSet.has(normaliseRemoteUrl(r.url)),
  );

  const dedupedTotal = localProjects.length + githubRepos.length;

  return {
    local: localProjects,
    github: githubRepos,
    dedupedTotal,
    ...(localError !== undefined ? { localError } : {}),
  };
}
