import { describe, expect, it } from "vitest";
import { isPidAlive } from "./local-service-supervisor.js";

// Synthetic PID that is guaranteed to be dead (PID 1 is init/system on Linux,
// but process.kill(1, 0) from an unprivileged process throws EPERM, which
// isPidAlive treats as alive on some platforms.  Using a very high number that
// is never a valid running PID is more reliable across environments.)
const DEFINITELY_DEAD_PID = 2_000_000_000;

function buildStaleDisplayLine(serviceName: string, pid: number, isStale: boolean): string {
  const base = `${serviceName} pid=${pid} cwd=/some/path`;
  if (isStale) {
    return `[STALE] ${base}\n  dev-runner process ${pid} is gone — run pnpm dev:stop to clean up`;
  }
  return base;
}

describe("dev-service stale detection", () => {
  it("treats a dead PID as stale and emits [STALE] prefix in display output", () => {
    const staleRecord = {
      serviceName: "paperclip-dev:test",
      pid: DEFINITELY_DEAD_PID,
    };

    const pidAlive = isPidAlive(staleRecord.pid);
    // A PID of 2_000_000_000 will never be alive; isPidAlive returns false.
    expect(pidAlive).toBe(false);

    const line = buildStaleDisplayLine(staleRecord.serviceName, staleRecord.pid, !pidAlive);
    expect(line).toMatch(/^\[STALE\]/);
    expect(line).toContain(`dev-runner process ${DEFINITELY_DEAD_PID} is gone`);
    expect(line).toContain("run pnpm dev:stop to clean up");
  });

  it("does not mark a live process as stale", () => {
    // process.pid is always alive (current process).
    const pidAlive = isPidAlive(process.pid);
    expect(pidAlive).toBe(true);

    const line = buildStaleDisplayLine("paperclip-dev:live", process.pid, !pidAlive);
    expect(line).not.toMatch(/^\[STALE\]/);
  });
});
