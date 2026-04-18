import { PaperclipApiError } from "./client.js";

type McpTextResponse = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

function toText(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

export function formatTextResponse(value: unknown): McpTextResponse {
  return {
    content: [{ type: "text", text: toText(value) }],
  };
}

export function formatErrorResponse(error: unknown): McpTextResponse {
  const payload =
    error instanceof PaperclipApiError
      ? {
          error: error.message,
          status: error.status,
          method: error.method,
          path: error.path,
          body: error.body,
        }
      : { error: error instanceof Error ? error.message : String(error) };

  return {
    content: [{ type: "text", text: toText(payload) }],
    isError: true,
  };
}
