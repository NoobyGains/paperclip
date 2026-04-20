import type { GithubBridgeConfig, ProjectWorkspaceRuntimeConfig } from "@paperclipai/shared";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? { ...value } : null;
}

function readGithubBridgeConfig(value: unknown): GithubBridgeConfig | null {
  if (!isRecord(value)) return null;
  if (typeof value.enabled !== "boolean") return null;
  const config: GithubBridgeConfig = { enabled: value.enabled };
  if (Array.isArray(value.labelFilter)) {
    config.labelFilter = value.labelFilter.filter((v) => typeof v === "string") as string[];
  }
  if (typeof value.agentIdOverride === "string") {
    config.agentIdOverride = value.agentIdOverride;
  }
  return config;
}

function readDesiredState(value: unknown): ProjectWorkspaceRuntimeConfig["desiredState"] {
  return value === "running" || value === "stopped" || value === "manual" ? value : null;
}

function readServiceStates(value: unknown): ProjectWorkspaceRuntimeConfig["serviceStates"] {
  if (!isRecord(value)) return null;
  const entries = Object.entries(value).filter(([, state]) =>
    state === "running" || state === "stopped" || state === "manual"
  );
  if (entries.length === 0) return null;
  return Object.fromEntries(entries) as ProjectWorkspaceRuntimeConfig["serviceStates"];
}

export function readProjectWorkspaceRuntimeConfig(
  metadata: Record<string, unknown> | null | undefined,
): ProjectWorkspaceRuntimeConfig | null {
  const raw = isRecord(metadata?.runtimeConfig) ? metadata.runtimeConfig : null;
  if (!raw) return null;

  const githubBridge = readGithubBridgeConfig(raw.githubBridge);
  const config: ProjectWorkspaceRuntimeConfig = {
    workspaceRuntime: cloneRecord(raw.workspaceRuntime),
    desiredState: readDesiredState(raw.desiredState),
    serviceStates: readServiceStates(raw.serviceStates),
    githubBridge: githubBridge ?? null,
  };

  const hasConfig = config.workspaceRuntime !== null || config.desiredState !== null || config.serviceStates !== null || config.githubBridge !== null;
  return hasConfig ? config : null;
}

export function mergeProjectWorkspaceRuntimeConfig(
  metadata: Record<string, unknown> | null | undefined,
  patch: Partial<ProjectWorkspaceRuntimeConfig> | null,
): Record<string, unknown> | null {
  const nextMetadata = isRecord(metadata) ? { ...metadata } : {};
  const current = readProjectWorkspaceRuntimeConfig(metadata) ?? {
    workspaceRuntime: null,
    desiredState: null,
    serviceStates: null,
  };

  if (patch === null) {
    delete nextMetadata.runtimeConfig;
    return Object.keys(nextMetadata).length > 0 ? nextMetadata : null;
  }

  const nextConfig: ProjectWorkspaceRuntimeConfig = {
    workspaceRuntime:
      patch.workspaceRuntime !== undefined ? cloneRecord(patch.workspaceRuntime) : current.workspaceRuntime,
    desiredState:
      patch.desiredState !== undefined ? readDesiredState(patch.desiredState) : current.desiredState,
    serviceStates:
      patch.serviceStates !== undefined ? readServiceStates(patch.serviceStates) : current.serviceStates,
    githubBridge:
      patch.githubBridge !== undefined ? readGithubBridgeConfig(patch.githubBridge) : (current.githubBridge ?? null),
  };

  if (nextConfig.workspaceRuntime === null && nextConfig.desiredState === null && nextConfig.serviceStates === null && nextConfig.githubBridge === null) {
    delete nextMetadata.runtimeConfig;
  } else {
    nextMetadata.runtimeConfig = nextConfig;
  }

  return Object.keys(nextMetadata).length > 0 ? nextMetadata : null;
}
