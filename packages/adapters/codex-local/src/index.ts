import type { AdapterModel } from "@paperclipai/adapter-utils";

export const type = "codex_local";
export const label = "Codex (local)";
export const DEFAULT_CODEX_LOCAL_MODEL = "gpt-5.3-codex";
export const DEFAULT_CODEX_LOCAL_BYPASS_APPROVALS_AND_SANDBOX = true;
export const CODEX_LOCAL_FAST_MODE_SUPPORTED_MODELS = ["gpt-5.4"] as const;

export function isCodexLocalFastModeSupported(model: string | null | undefined): boolean {
  const normalizedModel = typeof model === "string" ? model.trim() : "";
  return CODEX_LOCAL_FAST_MODE_SUPPORTED_MODELS.includes(
    normalizedModel as (typeof CODEX_LOCAL_FAST_MODE_SUPPORTED_MODELS)[number],
  );
}

export const models: AdapterModel[] = [
  {
    id: "gpt-5.4",
    label: "gpt-5.4",
    tier: "fast",
    recommendedFor: ["coding", "reasoning"],
    contextWindow: 400_000,
    notes: "Supports Codex Fast mode. Use for coding-heavy profile.",
  },
  {
    id: DEFAULT_CODEX_LOCAL_MODEL,
    label: DEFAULT_CODEX_LOCAL_MODEL,
    tier: "standard",
    recommendedFor: ["coding"],
    contextWindow: 400_000,
    notes: "Default — coding-standard profile.",
  },
  {
    id: "gpt-5.3-codex-spark",
    label: "gpt-5.3-codex-spark",
    tier: "standard",
    recommendedFor: ["coding"],
  },
  {
    id: "gpt-5",
    label: "gpt-5",
    tier: "standard",
    recommendedFor: ["coding", "reasoning"],
  },
  {
    id: "o3",
    label: "o3",
    tier: "thinking",
    recommendedFor: ["reasoning", "research"],
  },
  {
    id: "o4-mini",
    label: "o4-mini",
    tier: "mini",
    recommendedFor: ["simple"],
    notes: "Legacy default; prefer gpt-5.3-codex or gpt-5.4.",
  },
  {
    id: "gpt-5-mini",
    label: "gpt-5-mini",
    tier: "mini",
    recommendedFor: ["simple", "coding"],
  },
  {
    id: "gpt-5-nano",
    label: "gpt-5-nano",
    tier: "mini",
    recommendedFor: ["simple"],
  },
  {
    id: "o3-mini",
    label: "o3-mini",
    tier: "mini",
    recommendedFor: ["simple"],
  },
  {
    id: "codex-mini-latest",
    label: "Codex Mini",
    tier: "mini",
    recommendedFor: ["simple"],
  },
];

export const agentConfigurationDoc = `# codex_local agent configuration

Adapter: codex_local

Core fields:
- cwd (string, optional): default absolute working directory fallback for the agent process (created if missing when possible)
- instructionsFilePath (string, optional): absolute path to a markdown instructions file prepended to stdin prompt at runtime
- model (string, optional): Codex model id
- modelReasoningEffort (string, optional): reasoning effort override (minimal|low|medium|high|xhigh) passed via -c model_reasoning_effort=...
- promptTemplate (string, optional): run prompt template
- search (boolean, optional): run codex with --search
- fastMode (boolean, optional): enable Codex Fast mode; currently supported on GPT-5.4 only and consumes credits faster
- dangerouslyBypassApprovalsAndSandbox (boolean, optional): run with bypass flag
- command (string, optional): defaults to "codex"
- extraArgs (string[], optional): additional CLI args
- env (object, optional): KEY=VALUE environment variables
- workspaceStrategy (object, optional): execution workspace strategy; currently supports { type: "git_worktree", baseRef?, branchTemplate?, worktreeParentDir? }
- workspaceRuntime (object, optional): reserved for workspace runtime metadata; workspace runtime services are manually controlled from the workspace UI and are not auto-started by heartbeats

Operational fields:
- timeoutSec (number, optional): run timeout in seconds
- graceSec (number, optional): SIGTERM grace period in seconds

Notes:
- Prompts are piped via stdin (Codex receives "-" prompt argument).
- If instructionsFilePath is configured, Paperclip prepends that file's contents to the stdin prompt on every run.
- Codex exec automatically applies repo-scoped AGENTS.md instructions from the active workspace. Paperclip cannot suppress that discovery in exec mode, so repo AGENTS.md files may still apply even when you only configured an explicit instructionsFilePath.
- Paperclip injects desired local skills into the effective CODEX_HOME/skills/ directory at execution time so Codex can discover "$paperclip" and related skills without polluting the project working directory. In managed-home mode (the default) this is ~/.paperclip/instances/<id>/companies/<companyId>/codex-home/skills/; when CODEX_HOME is explicitly overridden in adapter config, that override is used instead.
- Unless explicitly overridden in adapter config, Paperclip runs Codex with a per-company managed CODEX_HOME under the active Paperclip instance and seeds auth/config from the shared Codex home (the CODEX_HOME env var, when set, or ~/.codex).
- Some model/tool combinations reject certain effort levels (for example minimal with web search enabled).
- Fast mode is currently supported on GPT-5.4 only. When enabled, Paperclip applies \`service_tier="fast"\` and \`features.fast_mode=true\`.
- When Paperclip realizes a workspace/runtime for a run, it injects PAPERCLIP_WORKSPACE_* and PAPERCLIP_RUNTIME_* env vars for agent-side tooling.
`;
