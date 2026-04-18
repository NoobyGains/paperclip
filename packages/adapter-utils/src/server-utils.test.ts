import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { runChildProcess } from "./server-utils.js";

function isPidAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForPidExit(pid: number, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isPidAlive(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return !isPidAlive(pid);
}

describe("runChildProcess", () => {
  it("sends stdin to the child without waiting for onSpawn to resolve", async () => {
    // Secondary fix for NoobyGains/paperclip#15: stdin must be written
    // immediately after spawn, NOT gated on the DB-persist promise
    // (spawnPersistPromise / onSpawn).  runChildProcess must resolve before
    // the slow onSpawn callback finishes, proving stdin was not gated on it.
    const spawnDelayMs = 300;
    let runProcessResolvedAt = 0;
    let onSpawnCompletedAt = 0;

    // Hold a reference to the onSpawn promise so we can await it after the
    // run resolves (runChildProcess does NOT await spawnPersistPromise).
    let onSpawnPromise: Promise<void> = Promise.resolve();

    const result = await runChildProcess(
      randomUUID(),
      process.execPath,
      [
        "-e",
        // Child reads stdin, writes it to stdout, then exits immediately.
        "let data='';process.stdin.setEncoding('utf8');process.stdin.on('data',chunk=>data+=chunk);process.stdin.on('end',()=>process.stdout.write(data));",
      ],
      {
        cwd: process.cwd(),
        env: {},
        stdin: "hello from stdin",
        timeoutSec: 5,
        graceSec: 1,
        onLog: async () => {},
        onSpawn: async () => {
          onSpawnPromise = (async () => {
            await new Promise((resolve) => setTimeout(resolve, spawnDelayMs));
            onSpawnCompletedAt = Date.now();
          })();
          return onSpawnPromise;
        },
      },
    );
    runProcessResolvedAt = Date.now();

    // Wait for onSpawn to fully complete (it runs in parallel, not awaited by
    // runChildProcess, so we have to wait ourselves for the assertion).
    await onSpawnPromise;

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("hello from stdin");
    // onSpawn still fires (pid persist still happens in parallel).
    expect(onSpawnCompletedAt).toBeGreaterThan(0);
    // Core invariant: runChildProcess resolved BEFORE onSpawn completed,
    // proving stdin was delivered without waiting for the DB-persist gate.
    expect(runProcessResolvedAt).toBeLessThan(onSpawnCompletedAt);
  });

  it("writes stdin before the DB-persist resolves (exit-before-persist ordering)", async () => {
    // Regression test for NoobyGains/paperclip#15 secondary fix.
    // Simulates the race where the child exits before a slow onSpawn
    // (DB persist) completes.  Stdin must have been written (and the child
    // read it) before onSpawn even resolves.
    const persistDelayMs = 300;
    let stdinReceivedAt = 0;
    let persistResolvedAt = 0;
    let onSpawnPromise: Promise<void> = Promise.resolve();

    const result = await runChildProcess(
      randomUUID(),
      process.execPath,
      [
        "-e",
        // Immediately echo stdin back on stdout, then exit.
        "let data='';process.stdin.setEncoding('utf8');process.stdin.on('data',chunk=>data+=chunk);process.stdin.on('end',()=>process.stdout.write(data));",
      ],
      {
        cwd: process.cwd(),
        env: {},
        stdin: "ordering-test-payload",
        timeoutSec: 5,
        graceSec: 1,
        onLog: async (stream, text) => {
          // The first stdout chunk proves stdin arrived at the child.
          if (stream === "stdout" && text.includes("ordering-test-payload") && stdinReceivedAt === 0) {
            stdinReceivedAt = Date.now();
          }
        },
        onSpawn: async () => {
          onSpawnPromise = (async () => {
            await new Promise((resolve) => setTimeout(resolve, persistDelayMs));
            persistResolvedAt = Date.now();
          })();
          return onSpawnPromise;
        },
      },
    );

    // Wait for the slow persist to complete so we can compare timestamps.
    await onSpawnPromise;

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("ordering-test-payload");

    // Key assertion: stdin bytes arrived at the child BEFORE the persist resolved.
    expect(stdinReceivedAt).toBeGreaterThan(0);
    expect(persistResolvedAt).toBeGreaterThan(0);
    expect(stdinReceivedAt).toBeLessThan(persistResolvedAt);
  });

  it.skipIf(process.platform === "win32")("kills descendant processes on timeout via the process group", async () => {
    let descendantPid: number | null = null;

    const result = await runChildProcess(
      randomUUID(),
      process.execPath,
      [
        "-e",
        [
          "const { spawn } = require('node:child_process');",
          "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });",
          "process.stdout.write(String(child.pid));",
          "setInterval(() => {}, 1000);",
        ].join(" "),
      ],
      {
        cwd: process.cwd(),
        env: {},
        timeoutSec: 1,
        graceSec: 1,
        onLog: async () => {},
        onSpawn: async () => {},
      },
    );

    descendantPid = Number.parseInt(result.stdout.trim(), 10);
    expect(result.timedOut).toBe(true);
    expect(Number.isInteger(descendantPid) && descendantPid > 0).toBe(true);

    expect(await waitForPidExit(descendantPid!, 2_000)).toBe(true);
  });
});
