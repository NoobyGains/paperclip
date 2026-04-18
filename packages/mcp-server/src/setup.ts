/**
 * Standalone `--setup` CLI for the Paperclip MCP server.
 *
 * Flow:
 *   1. POST /api/cli-auth/challenges to start a browser-approval challenge.
 *   2. Open the approval URL in the user's browser.
 *   3. Poll /api/cli-auth/challenges/:id until approved.
 *   4. Use the issued board API key to resolve the company (or ask the user
 *      to pick one if multiple companies are accessible).
 *   5. Print a ready-to-paste .mcp.json block on stdout.
 */
import { spawn } from "node:child_process";
import { normalizeApiUrl } from "./config.js";

export interface SetupOptions {
  paperclipBaseUrl: string;
  companyId?: string | null;
  clientName?: string;
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
  skipOpenBrowser?: boolean;
  stdout?: (line: string) => void;
  stderr?: (line: string) => void;
}

interface CliAuthChallengeCreated {
  id: string;
  token: string;
  boardApiToken: string;
  approvalPath: string;
  approvalUrl: string | null;
  pollPath: string;
  expiresAt: string;
  suggestedPollIntervalMs?: number;
}

interface CliAuthChallengeStatus {
  id: string;
  status: "pending" | "approved" | "cancelled" | "expired";
  requestedAccess?: string;
  [key: string]: unknown;
}

function openBrowser(url: string, stderr: (line: string) => void): void {
  const cmd =
    process.platform === "win32"
      ? "start"
      : process.platform === "darwin"
        ? "open"
        : "xdg-open";
  const args = process.platform === "win32" ? ["", url] : [url];
  try {
    const child = spawn(cmd, args, {
      detached: true,
      stdio: "ignore",
      shell: process.platform === "win32",
    });
    child.unref();
  } catch (error) {
    stderr(
      `Could not open browser automatically (${error instanceof Error ? error.message : String(error)}). Visit the URL above manually.`,
    );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function createChallenge(
  apiBase: string,
  clientName: string,
): Promise<CliAuthChallengeCreated> {
  const response = await fetch(`${apiBase}/api/cli-auth/challenges`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      command: "paperclip-mcp-server --setup",
      clientName,
      requestedAccess: "board",
    }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Failed to create CLI auth challenge (${response.status}): ${body}`,
    );
  }
  return (await response.json()) as CliAuthChallengeCreated;
}

async function pollChallenge(
  apiBase: string,
  id: string,
  token: string,
): Promise<CliAuthChallengeStatus | null> {
  const url = `${apiBase}/api/cli-auth/challenges/${encodeURIComponent(id)}?token=${encodeURIComponent(token)}`;
  const response = await fetch(url);
  if (!response.ok) return null;
  return (await response.json()) as CliAuthChallengeStatus;
}

async function listCompanies(
  apiBase: string,
  apiKey: string,
): Promise<Array<Record<string, unknown>>> {
  const response = await fetch(`${apiBase}/api/companies`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!response.ok) {
    throw new Error(
      `Failed to list companies with the new API key (status ${response.status}). The key may not have the expected permissions.`,
    );
  }
  const body = (await response.json()) as unknown;
  return Array.isArray(body) ? (body as Array<Record<string, unknown>>) : [];
}

function renderMcpJson(params: {
  apiBase: string;
  apiKey: string;
  companyId: string;
}): string {
  const snippet = {
    mcpServers: {
      paperclip: {
        command: "npx",
        args: ["-y", "@paperclipai/mcp-server"],
        env: {
          PAPERCLIP_API_URL: params.apiBase,
          PAPERCLIP_API_KEY: params.apiKey,
          PAPERCLIP_COMPANY_ID: params.companyId,
        },
      },
    },
  };
  return JSON.stringify(snippet, null, 2);
}

export async function runSetup(options: SetupOptions): Promise<number> {
  const stdout = options.stdout ?? ((line) => process.stdout.write(`${line}\n`));
  const stderr = options.stderr ?? ((line) => process.stderr.write(`${line}\n`));

  const apiUrl = normalizeApiUrl(options.paperclipBaseUrl);
  const apiBase = apiUrl.replace(/\/api$/, "");
  const pollInterval = options.pollIntervalMs ?? 1500;
  const pollTimeout = options.pollTimeoutMs ?? 5 * 60 * 1000;

  stdout(`Paperclip MCP setup against ${apiBase}`);
  stdout("");

  const challenge = await createChallenge(
    apiBase,
    options.clientName ?? "Paperclip MCP Setup",
  );
  const approvalUrl =
    challenge.approvalUrl ?? `${apiBase}${challenge.approvalPath}`;

  stdout(`1) Open this URL and approve the request as a board user:`);
  stdout(`   ${approvalUrl}`);
  stdout("");
  if (!options.skipOpenBrowser) {
    openBrowser(approvalUrl, stderr);
  }

  stdout("2) Waiting for approval...");
  const deadline = Date.now() + pollTimeout;
  let status: CliAuthChallengeStatus | null = null;
  while (Date.now() < deadline) {
    status = await pollChallenge(apiBase, challenge.id, challenge.token);
    if (status?.status === "approved") break;
    if (status?.status === "cancelled" || status?.status === "expired") {
      stderr(`Challenge ${status.status}. Re-run --setup to retry.`);
      return 1;
    }
    await sleep(pollInterval);
  }
  if (!status || status.status !== "approved") {
    stderr(
      `Timed out after ${Math.round(pollTimeout / 1000)}s waiting for approval. Re-run --setup to retry.`,
    );
    return 2;
  }

  stdout("3) Approved. Resolving company context...");
  const apiKey = challenge.boardApiToken;

  let companyId = options.companyId?.trim() || null;
  if (!companyId) {
    const companies = await listCompanies(apiBase, apiKey);
    if (companies.length === 0) {
      stderr(
        "No companies are accessible with this key. Create a company in the web UI first, then re-run --setup.",
      );
      return 3;
    }
    if (companies.length > 1) {
      stdout("");
      stdout("Multiple companies are accessible with this key. Pick one:");
      for (const c of companies) {
        stdout(`  - ${String(c.id)}  ${String(c.name)}`);
      }
      stdout("");
      stdout(
        "Re-run with --company <id> to lock the MCP to a specific company, or edit PAPERCLIP_COMPANY_ID in the snippet below.",
      );
      companyId = String(companies[0]!.id);
    } else {
      companyId = String(companies[0]!.id);
      stdout(`   Using company ${String(companies[0]!.name)} (${companyId})`);
    }
  }

  stdout("");
  stdout("4) Done. Paste the following block into your .mcp.json (or the");
  stdout("   Claude Code MCP settings UI):");
  stdout("");
  stdout(renderMcpJson({ apiBase, apiKey, companyId }));
  stdout("");
  stdout(
    "   (The API key above is a long-lived board key. Treat it like a password.)",
  );
  return 0;
}

export function parseSetupArgs(argv: readonly string[]): SetupOptions | null {
  let seenFlag = false;
  let url: string | null = null;
  let companyId: string | null = null;
  let skipOpenBrowser = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--setup") {
      seenFlag = true;
      const next = argv[i + 1];
      if (next && !next.startsWith("-")) {
        url = next;
        i++;
      }
    } else if (a === "--company") {
      companyId = argv[i + 1] ?? null;
      i++;
    } else if (a === "--no-browser") {
      skipOpenBrowser = true;
    }
  }
  if (!seenFlag) return null;
  if (!url) {
    process.stderr.write(
      "Usage: paperclip-mcp-server --setup <paperclip-base-url> [--company <id>] [--no-browser]\n",
    );
    return null;
  }
  return {
    paperclipBaseUrl: url,
    companyId,
    skipOpenBrowser,
  };
}
