import type { PaperclipMcpConfig } from "./config.js";

export class PaperclipApiError extends Error {
  readonly status: number;
  readonly method: string;
  readonly path: string;
  readonly body: unknown;

  constructor(input: {
    status: number;
    method: string;
    path: string;
    body: unknown;
    message: string;
  }) {
    super(input.message);
    this.name = "PaperclipApiError";
    this.status = input.status;
    this.method = input.method;
    this.path = input.path;
    this.body = input.body;
  }
}

export interface JsonRequestOptions {
  body?: unknown;
  includeRunId?: boolean;
}

function isWriteMethod(method: string): boolean {
  return !["GET", "HEAD"].includes(method.toUpperCase());
}

function buildErrorMessage(method: string, path: string, status: number, body: unknown): string {
  if (body && typeof body === "object" && "error" in body && typeof body.error === "string") {
    return `${method} ${path} failed with ${status}: ${body.error}`;
  }
  return `${method} ${path} failed with ${status}`;
}

async function parseResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export class PaperclipApiClient {
  constructor(private readonly config: PaperclipMcpConfig) {}

  get defaults() {
    return {
      companyId: this.config.companyId,
      agentId: this.config.agentId,
      runId: this.config.runId,
    };
  }

  resolveCompanyId(companyId?: string | null): string {
    const resolved = companyId?.trim() || this.config.companyId;
    if (!resolved) {
      throw new Error("companyId is required because PAPERCLIP_COMPANY_ID is not set");
    }
    return resolved;
  }

  resolveAgentId(agentId?: string | null): string {
    const resolved = agentId?.trim() || this.config.agentId;
    if (!resolved) {
      throw new Error("agentId is required because PAPERCLIP_AGENT_ID is not set");
    }
    return resolved;
  }

  async writeCeoOverlay(projectId: string, files: Record<string, string>): Promise<Record<string, unknown>> {
    return this.requestJson("POST", `/projects/${encodeURIComponent(projectId)}/ceo-overlay`, { body: { files } });
  }

  async fetchRawText(path: string): Promise<string> {
    if (!path.startsWith("/")) {
      throw new Error(`raw path must start with "/": ${path}`);
    }
    // apiUrl is normalized to end in /api; strip that for non-/api endpoints.
    const apiBase = this.config.apiUrl.replace(/\/api$/, "");
    const response = await fetch(`${apiBase}${path}`, {
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        Accept: "text/plain",
      },
    });
    if (!response.ok) {
      const body = await response.text();
      throw new PaperclipApiError({
        status: response.status,
        method: "GET",
        path,
        body,
        message: `GET ${path} failed with ${response.status}`,
      });
    }
    return response.text();
  }

  async detectProjectArchetype(repoPath: string): Promise<Record<string, unknown>> {
    return this.requestJson("POST", "/project-archetype/detect", { body: { repoPath } });
  }

  async requestJson<T>(method: string, path: string, options: JsonRequestOptions = {}): Promise<T> {
    if (!path.startsWith("/")) {
      throw new Error(`API path must start with "/": ${path}`);
    }

    const url = new URL(path.slice(1), `${this.config.apiUrl}/`);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.config.apiKey}`,
      Accept: "application/json",
    };
    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
    }
    if ((options.includeRunId ?? isWriteMethod(method)) && this.config.runId) {
      headers["X-Paperclip-Run-Id"] = this.config.runId;
    }

    const response = await fetch(url, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const parsedBody = await parseResponseBody(response);

    if (!response.ok) {
      throw new PaperclipApiError({
        status: response.status,
        method: method.toUpperCase(),
        path,
        body: parsedBody,
        message: buildErrorMessage(method.toUpperCase(), path, response.status, parsedBody),
      });
    }

    return parsedBody as T;
  }

  /** Lazily-fetched operator profile, cached for the lifetime of this client instance. */
  private _profileCache: Record<string, unknown> | null = null;
  private _profileFetchPromise: Promise<Record<string, unknown>> | null = null;

  async getMyProfile(): Promise<Record<string, unknown>> {
    return this.requestJson("GET", "/me/profile");
  }

  /**
   * Fetch the operator profile exactly once per session and cache it.
   * Subsequent calls return the cached value synchronously.
   * On any fetch failure, resolves to null so callers can fall back gracefully.
   */
  async getCachedProfile(): Promise<Record<string, unknown> | null> {
    if (this._profileCache !== null) return this._profileCache;
    if (this._profileFetchPromise) return this._profileFetchPromise;
    this._profileFetchPromise = this.getMyProfile()
      .then((profile) => {
        this._profileCache = profile;
        return profile;
      })
      .catch(() => {
        // Swallow the error — callers fall back to static descriptions.
        return null as unknown as Record<string, unknown>;
      });
    const result = await this._profileFetchPromise;
    this._profileFetchPromise = null;
    return result;
  }

  async updateMyProfile(body: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.requestJson("PATCH", "/me/profile", { body });
  }
}
