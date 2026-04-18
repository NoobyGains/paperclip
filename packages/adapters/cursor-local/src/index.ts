import type { AdapterModel } from "@paperclipai/adapter-utils";

export const type = "cursor";
export const label = "Cursor CLI (local)";
export const DEFAULT_CURSOR_LOCAL_MODEL = "auto";

export const models: AdapterModel[] = [
  // ── Cursor routing ───────────────────────────────────────────────────────
  {
    id: "auto",
    label: "auto",
    notes: "Let Cursor route to its best available model",
  },

  // ── Cursor Composer ──────────────────────────────────────────────────────
  {
    id: "composer-1.5",
    label: "composer-1.5",
    tier: "standard",
    recommendedFor: ["coding"],
  },
  {
    id: "composer-1",
    label: "composer-1",
    tier: "standard",
    recommendedFor: ["coding"],
  },

  // ── GPT-5.3-Codex variants ───────────────────────────────────────────────
  {
    id: "gpt-5.3-codex-low",
    label: "gpt-5.3-codex-low",
    tier: "standard",
    recommendedFor: ["coding"],
  },
  {
    id: "gpt-5.3-codex-low-fast",
    label: "gpt-5.3-codex-low-fast",
    tier: "standard",
    recommendedFor: ["coding"],
  },
  {
    id: "gpt-5.3-codex",
    label: "gpt-5.3-codex",
    tier: "standard",
    recommendedFor: ["coding", "reasoning"],
  },
  {
    id: "gpt-5.3-codex-fast",
    label: "gpt-5.3-codex-fast",
    tier: "standard",
    recommendedFor: ["coding", "reasoning"],
  },
  {
    id: "gpt-5.3-codex-high",
    label: "gpt-5.3-codex-high",
    tier: "standard",
    recommendedFor: ["coding", "reasoning"],
  },
  {
    id: "gpt-5.3-codex-high-fast",
    label: "gpt-5.3-codex-high-fast",
    tier: "standard",
    recommendedFor: ["coding", "reasoning"],
  },
  {
    id: "gpt-5.3-codex-xhigh",
    label: "gpt-5.3-codex-xhigh",
    tier: "standard",
    recommendedFor: ["coding", "reasoning"],
  },
  {
    id: "gpt-5.3-codex-xhigh-fast",
    label: "gpt-5.3-codex-xhigh-fast",
    tier: "standard",
    recommendedFor: ["coding", "reasoning"],
  },
  {
    id: "gpt-5.3-codex-spark-preview",
    label: "gpt-5.3-codex-spark-preview",
    tier: "standard",
    recommendedFor: ["coding"],
  },

  // ── GPT-5.2 variants ─────────────────────────────────────────────────────
  {
    id: "gpt-5.2",
    label: "gpt-5.2",
    tier: "standard",
    recommendedFor: ["coding"],
  },
  {
    id: "gpt-5.2-codex-low",
    label: "gpt-5.2-codex-low",
    tier: "standard",
    recommendedFor: ["coding"],
  },
  {
    id: "gpt-5.2-codex-low-fast",
    label: "gpt-5.2-codex-low-fast",
    tier: "standard",
    recommendedFor: ["coding"],
  },
  {
    id: "gpt-5.2-codex",
    label: "gpt-5.2-codex",
    tier: "standard",
    recommendedFor: ["coding"],
  },
  {
    id: "gpt-5.2-codex-fast",
    label: "gpt-5.2-codex-fast",
    tier: "standard",
    recommendedFor: ["coding"],
  },
  {
    id: "gpt-5.2-codex-high",
    label: "gpt-5.2-codex-high",
    tier: "standard",
    recommendedFor: ["coding"],
  },
  {
    id: "gpt-5.2-codex-high-fast",
    label: "gpt-5.2-codex-high-fast",
    tier: "standard",
    recommendedFor: ["coding"],
  },
  {
    id: "gpt-5.2-codex-xhigh",
    label: "gpt-5.2-codex-xhigh",
    tier: "standard",
    recommendedFor: ["coding"],
  },
  {
    id: "gpt-5.2-codex-xhigh-fast",
    label: "gpt-5.2-codex-xhigh-fast",
    tier: "standard",
    recommendedFor: ["coding"],
  },
  {
    id: "gpt-5.2-high",
    label: "gpt-5.2-high",
    tier: "standard",
    recommendedFor: ["coding"],
  },

  // ── GPT-5.1 variants ─────────────────────────────────────────────────────
  {
    id: "gpt-5.1-codex-max",
    label: "gpt-5.1-codex-max",
    tier: "standard",
    recommendedFor: ["coding"],
  },
  {
    id: "gpt-5.1-codex-max-high",
    label: "gpt-5.1-codex-max-high",
    tier: "standard",
    recommendedFor: ["coding"],
  },
  {
    id: "gpt-5.1-high",
    label: "gpt-5.1-high",
    tier: "standard",
    recommendedFor: ["coding"],
  },
  {
    id: "gpt-5.1-codex-mini",
    label: "gpt-5.1-codex-mini",
    tier: "mini",
    recommendedFor: ["simple"],
  },

  // ── Claude Opus variants ─────────────────────────────────────────────────
  {
    id: "opus-4.6-thinking",
    label: "opus-4.6-thinking",
    tier: "thinking",
    recommendedFor: ["reasoning", "research"],
  },
  {
    id: "opus-4.6",
    label: "opus-4.6",
    tier: "standard",
    recommendedFor: ["coding", "reasoning"],
  },
  {
    id: "opus-4.5",
    label: "opus-4.5",
    tier: "standard",
    recommendedFor: ["coding"],
  },
  {
    id: "opus-4.5-thinking",
    label: "opus-4.5-thinking",
    tier: "thinking",
    recommendedFor: ["reasoning", "research"],
  },

  // ── Claude Sonnet variants ───────────────────────────────────────────────
  {
    id: "sonnet-4.6",
    label: "sonnet-4.6",
    tier: "standard",
    recommendedFor: ["coding", "reasoning"],
  },
  {
    id: "sonnet-4.6-thinking",
    label: "sonnet-4.6-thinking",
    tier: "thinking",
    recommendedFor: ["reasoning", "research"],
  },
  {
    id: "sonnet-4.5",
    label: "sonnet-4.5",
    tier: "standard",
    recommendedFor: ["coding"],
  },
  {
    id: "sonnet-4.5-thinking",
    label: "sonnet-4.5-thinking",
    tier: "thinking",
    recommendedFor: ["reasoning", "research"],
  },

  // ── Gemini variants ──────────────────────────────────────────────────────
  {
    id: "gemini-3.1-pro",
    label: "gemini-3.1-pro",
    tier: "thinking",
    recommendedFor: ["reasoning", "research"],
  },
  {
    id: "gemini-3-pro",
    label: "gemini-3-pro",
    tier: "thinking",
    recommendedFor: ["reasoning", "research"],
  },
  {
    id: "gemini-3-flash",
    label: "gemini-3-flash",
    tier: "mini",
    recommendedFor: ["simple"],
  },

  // ── Other providers ──────────────────────────────────────────────────────
  {
    id: "grok",
    label: "grok",
    tier: "standard",
    recommendedFor: ["coding"],
  },
  {
    id: "kimi-k2.5",
    label: "kimi-k2.5",
    tier: "standard",
    recommendedFor: ["coding"],
  },
];

export const agentConfigurationDoc = `# cursor agent configuration

Adapter: cursor

Use when:
- You want Paperclip to run Cursor Agent CLI locally as the agent runtime
- You want Cursor chat session resume across heartbeats via --resume
- You want structured stream output in run logs via --output-format stream-json

Don't use when:
- You need webhook-style external invocation (use openclaw_gateway or http)
- You only need one-shot shell commands (use process)
- Cursor Agent CLI is not installed on the machine

Core fields:
- cwd (string, optional): default absolute working directory fallback for the agent process (created if missing when possible)
- instructionsFilePath (string, optional): absolute path to a markdown instructions file prepended to the run prompt
- promptTemplate (string, optional): run prompt template
- model (string, optional): Cursor model id (for example auto or gpt-5.3-codex)
- mode (string, optional): Cursor execution mode passed as --mode (plan|ask). Leave unset for normal autonomous runs.
- command (string, optional): defaults to "agent"
- extraArgs (string[], optional): additional CLI args
- env (object, optional): KEY=VALUE environment variables

Operational fields:
- timeoutSec (number, optional): run timeout in seconds
- graceSec (number, optional): SIGTERM grace period in seconds

Notes:
- Runs are executed with: agent -p --output-format stream-json ...
- Prompts are piped to Cursor via stdin.
- Sessions are resumed with --resume when stored session cwd matches current cwd.
- Paperclip auto-injects local skills into "~/.cursor/skills" when missing, so Cursor can discover "$paperclip" and related skills on local runs.
- Paperclip auto-adds --yolo unless one of --trust/--yolo/-f is already present in extraArgs.
`;
