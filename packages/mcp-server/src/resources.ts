import { PaperclipApiClient } from "./client.js";
import { diagnoseCompany } from "./diagnostics.js";

export interface ResourceDefinition {
  name: string;
  uri: string;
  description: string;
  mimeType: string;
  read: () => Promise<string>;
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

async function readJson(
  client: PaperclipApiClient,
  path: string,
): Promise<string> {
  const body = await client.requestJson<unknown>("GET", path);
  return asText(body);
}

export function createResourceDefinitions(
  client: PaperclipApiClient,
): ResourceDefinition[] {
  const companyPath = (segment: string) =>
    `/companies/${client.resolveCompanyId()}${segment}`;

  return [
    {
      name: "Company summary",
      uri: "paperclip://company/summary",
      description:
        "Company record including settings, status, pause reason, budget totals, and the board toggles (requireBoardApprovalForNewAgents, codexSandboxLoopbackEnabled, etc.).",
      mimeType: "application/json",
      read: async () => readJson(client, `/companies/${client.resolveCompanyId()}`),
    },
    {
      name: "Agents",
      uri: "paperclip://agents",
      description:
        "All agents in the current company with status, pauseReason, adapterType, reportsTo, and lastHeartbeatAt.",
      mimeType: "application/json",
      read: async () => readJson(client, companyPath("/agents")),
    },
    {
      name: "Open issues",
      uri: "paperclip://issues/open",
      description: "All issues in a non-terminal status (in_progress).",
      mimeType: "application/json",
      read: async () => readJson(client, companyPath("/issues?status=in_progress")),
    },
    {
      name: "Blocked issues",
      uri: "paperclip://issues/blocked",
      description: "Issues in the blocked status with their blockedByIssueIds chain.",
      mimeType: "application/json",
      read: async () => readJson(client, companyPath("/issues?status=blocked")),
    },
    {
      name: "Recent heartbeat runs",
      uri: "paperclip://runs/recent",
      description: "Last 50 heartbeat runs across all agents in the current company.",
      mimeType: "application/json",
      read: async () => readJson(client, companyPath("/heartbeat-runs?limit=50")),
    },
    {
      name: "Pending approvals",
      uri: "paperclip://approvals/pending",
      description: "All approvals still in a pending state.",
      mimeType: "application/json",
      read: async () => readJson(client, companyPath("/approvals?status=pending")),
    },
    {
      name: "Stuck diagnostics",
      uri: "paperclip://stuck",
      description:
        "One-shot health check: paused/over-budget agents, issues with stale execution locks, overdue approvals, and overdue routines. Read this first when the board says 'anything stuck?'",
      mimeType: "application/json",
      read: async () => asText(await diagnoseCompany(client)),
    },
    {
      name: "Routine schedule",
      uri: "paperclip://routines/schedule",
      description: "All routines with their nextRunAt and lastTriggeredAt fields.",
      mimeType: "application/json",
      read: async () => readJson(client, companyPath("/routines")),
    },
    {
      name: "Operator guide",
      uri: "paperclip://docs/operator-guide",
      description:
        "The Paperclip Operator Context Pack — feature reference, key diagnostic fields, and recommended workflow. Read once when connecting.",
      mimeType: "text/markdown",
      read: async () => client.fetchRawText("/llms/operator-context.txt"),
    },
  ];
}
