import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { PaperclipApiClient } from "./client.js";
import { readConfigFromEnv, type PaperclipMcpConfig } from "./config.js";
import { createResourceDefinitions } from "./resources.js";
import { createDynamicToolDefinitions } from "./tools.js";

/**
 * Build and wire the MCP server.
 *
 * Tool descriptions are rendered dynamically: the operator profile is fetched
 * once (and session-cached) so descriptions can reflect the operator's
 * subscription tier and preferences. Falls back to static descriptions if the
 * profile fetch fails.
 */
export async function createPaperclipMcpServer(config: PaperclipMcpConfig = readConfigFromEnv()) {
  const server = new McpServer({
    name: "paperclip",
    version: "0.1.0",
  });

  const client = new PaperclipApiClient(config);
  const tools = await createDynamicToolDefinitions(client);
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.schema.shape,
        ...(tool.annotations ? { annotations: tool.annotations } : {}),
      },
      tool.execute,
    );
  }

  const resources = createResourceDefinitions(client);
  for (const resource of resources) {
    server.registerResource(
      resource.name,
      resource.uri,
      {
        title: resource.title,
        description: resource.description,
        mimeType: resource.mimeType,
      },
      async (uri) => {
        const text = await resource.read();
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: resource.mimeType,
              text,
            },
          ],
        };
      },
    );
  }

  return {
    server,
    tools,
    resources,
    client,
  };
}

export async function runServer(config: PaperclipMcpConfig = readConfigFromEnv()) {
  const { server } = await createPaperclipMcpServer(config);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
