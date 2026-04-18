import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AGENT_ADAPTER_TYPES,
  AGENT_ROLES,
  AGENT_STATUSES,
  APPROVAL_STATUSES,
  APPROVAL_TYPES,
  COMPANY_STATUSES,
  HEARTBEAT_RUN_STATUSES,
  ISSUE_STATUSES,
  ROUTINE_CATCH_UP_POLICIES,
  ROUTINE_CONCURRENCY_POLICIES,
} from "@paperclipai/shared";
import { listServerAdapters } from "../adapters/index.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const NARRATIVE_PATH = path.resolve(
  HERE,
  "../onboarding-assets/operator-context/OPERATOR.md",
);
const FIRST_RUN_PATH = path.resolve(
  HERE,
  "../onboarding-assets/operator-context/FIRST_RUN.md",
);

let narrativeCache: string | null = null;
let firstRunCache: string | null = null;

async function loadNarrative(): Promise<string> {
  if (narrativeCache !== null) return narrativeCache;
  narrativeCache = await readFile(NARRATIVE_PATH, "utf8");
  return narrativeCache;
}

async function loadFirstRun(): Promise<string> {
  if (firstRunCache !== null) return firstRunCache;
  firstRunCache = await readFile(FIRST_RUN_PATH, "utf8");
  return firstRunCache;
}

export async function buildFirstRunGuide(): Promise<string> {
  return loadFirstRun();
}

function bulletList(values: readonly string[]): string {
  return values.map((value) => `- \`${value}\``).join("\n");
}

function buildDynamicSection(): string {
  const registeredAdapters = listServerAdapters()
    .map((adapter) => adapter.type)
    .sort();

  const sections: string[] = [
    "## Live enums (stitched at request time)",
    "",
    "The following lists come directly from this server's code and change as the server is updated. Compare them against the narrative above if something mentioned in the narrative doesn't appear here — that means it was removed.",
    "",
    "### Company status values",
    bulletList(COMPANY_STATUSES),
    "",
    "### Agent status values",
    bulletList(AGENT_STATUSES),
    "",
    "### Agent roles",
    bulletList(AGENT_ROLES),
    "",
    "### Agent adapter types (defined by shared constants)",
    bulletList(AGENT_ADAPTER_TYPES),
    "",
    "### Adapters registered on this server instance",
    registeredAdapters.length > 0
      ? bulletList(registeredAdapters)
      : "_(no adapters registered)_",
    "",
    "### Issue status values",
    bulletList(ISSUE_STATUSES),
    "",
    "### Heartbeat run status values",
    bulletList(HEARTBEAT_RUN_STATUSES),
    "",
    "Terminal heartbeat run statuses (used by execution-lock stale recovery):",
    bulletList(["succeeded", "failed", "cancelled", "timed_out"]),
    "",
    "### Approval types",
    bulletList(APPROVAL_TYPES),
    "",
    "### Approval statuses",
    bulletList(APPROVAL_STATUSES),
    "",
    "### Routine concurrency policies",
    bulletList(ROUTINE_CONCURRENCY_POLICIES),
    "",
    "### Routine catch-up policies",
    bulletList(ROUTINE_CATCH_UP_POLICIES),
    "",
  ];
  return sections.join("\n");
}

export async function buildOperatorContext(): Promise<string> {
  const narrative = await loadNarrative();
  const dynamic = buildDynamicSection();
  return `${narrative.trimEnd()}\n\n${dynamic}`;
}

export function resetOperatorContextCacheForTests(): void {
  narrativeCache = null;
  firstRunCache = null;
}
