import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function execGh<T>(args: string[], options?: { cwd?: string }) {
  const ghCli = process.env.GH_CLI?.trim() || "gh";
  try {
    const { stdout } = await execFileAsync(ghCli, args, {
      cwd: options?.cwd,
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024,
    });
    const trimmed = stdout.trim();
    if (!trimmed) {
      return [] as T;
    }
    return JSON.parse(trimmed) as T;
  } catch (error) {
    const err = error as Error & {
      stderr?: string;
      stdout?: string;
      code?: string | number;
    };
    const details = err.stderr?.trim() || err.stdout?.trim() || err.message;
    throw new Error(`gh ${args.join(" ")} failed${err.code ? ` (${String(err.code)})` : ""}: ${details}`);
  }
}
