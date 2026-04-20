#!/usr/bin/env -S node --import tsx
import { listLocalServiceRegistryRecords, removeLocalServiceRegistryRecord, terminateLocalService, isPidAlive } from "../server/src/services/local-service-supervisor.ts";
import type { LocalServiceRegistryRecord } from "../server/src/services/local-service-supervisor.ts";
import { repoRoot } from "./dev-service-profile.ts";

const HEALTH_CHECK_TIMEOUT_MS = 2000;

async function isUrlAlive(url: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS);
    try {
      const response = await fetch(`${url}/api/health`, { signal: controller.signal });
      return response.ok;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return false;
  }
}

async function checkRecordStaleness(record: LocalServiceRegistryRecord): Promise<boolean> {
  const pidAlive = isPidAlive(record.pid);
  if (!pidAlive) return true;

  const url = typeof record.metadata?.url === "string" ? record.metadata.url : record.url;
  if (url) {
    const urlAlive = await isUrlAlive(url);
    if (!urlAlive) return true;
  }

  return false;
}

function toDisplayLines(records: Awaited<ReturnType<typeof listLocalServiceRegistryRecords>>, staleKeys: Set<string>) {
  return records.map((record) => {
    const childPid = typeof record.metadata?.childPid === "number" ? ` child=${record.metadata.childPid}` : "";
    const url = typeof record.metadata?.url === "string" ? ` url=${record.metadata.url}` : "";
    const base = `${record.serviceName} pid=${record.pid}${childPid} cwd=${record.cwd}${url}`;
    if (staleKeys.has(record.serviceKey)) {
      return `[STALE] ${base}\n  dev-runner process ${record.pid} is gone — run pnpm dev:stop to clean up`;
    }
    return base;
  });
}

const command = process.argv[2] ?? "list";
const pruneFlag = process.argv.includes("--prune");
const records = await listLocalServiceRegistryRecords({
  profileKind: "paperclip-dev",
  metadata: { repoRoot },
});

if (command === "list") {
  if (records.length === 0) {
    console.log("No Paperclip dev services registered for this repo.");
    process.exit(0);
  }

  const staleKeys = new Set<string>();
  await Promise.all(
    records.map(async (record) => {
      const stale = await checkRecordStaleness(record);
      if (stale) staleKeys.add(record.serviceKey);
    }),
  );

  for (const line of toDisplayLines(records, staleKeys)) {
    console.log(line);
  }

  if (pruneFlag && staleKeys.size > 0) {
    for (const record of records) {
      if (staleKeys.has(record.serviceKey)) {
        await removeLocalServiceRegistryRecord(record.serviceKey);
        console.log(`Pruned stale entry for ${record.serviceName} (pid ${record.pid})`);
      }
    }
  }

  process.exit(0);
}

if (command === "stop") {
  if (records.length === 0) {
    console.log("No Paperclip dev services registered for this repo.");
    process.exit(0);
  }
  for (const record of records) {
    await terminateLocalService(record);
    await removeLocalServiceRegistryRecord(record.serviceKey);
    console.log(`Stopped ${record.serviceName} (pid ${record.pid})`);
  }
  process.exit(0);
}

console.error(`Unknown dev-service command: ${command}`);
process.exit(1);
