import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { getPrisma } from "../db/prisma.js";
import type { AgentTool } from "./tool-types.js";

/**
 * Connects to every enabled McpServer row, lists their tools, and returns a
 * merged array of {schema, execute} entries namespaced by server name
 * (`serverName__toolName`) so tool names never collide across servers.
 *
 * Called on demand by the orchestrator for each inbound message (no
 * persistent background connections), keeping this purely reactive: nothing
 * here runs unless triggered by handling an inbound WhatsApp message.
 */
export async function loadMcpTools(): Promise<AgentTool[]> {
  const prisma = getPrisma();
  const servers = await prisma.mcpServer.findMany({ where: { enabled: true } });

  const tools: AgentTool[] = [];

  for (const server of servers) {
    try {
      const client = new Client({ name: "openrm", version: "0.1.0" }, { capabilities: {} });

      if (server.transport === "stdio") {
        if (!server.command) continue;
        const transport = new StdioClientTransport({
          command: server.command,
          args: server.args ?? [],
        });
        await client.connect(transport);
      } else if (server.transport === "http") {
        if (!server.url) continue;
        const transport = new StreamableHTTPClientTransport(new URL(server.url));
        await client.connect(transport);
      } else {
        continue;
      }

      const { tools: serverTools } = await client.listTools();
      for (const t of serverTools) {
        tools.push({
          definition: {
            name: `${server.name}__${t.name}`,
            description: t.description ?? `Tool ${t.name} from MCP server ${server.name}`,
            parameters: (t.inputSchema as Record<string, unknown>) ?? {
              type: "object",
              properties: {},
            },
          },
          async execute(args) {
            const result = await client.callTool({ name: t.name, arguments: args });
            const content = result.content;
            if (Array.isArray(content)) {
              return content
                .map((c) => (c.type === "text" ? c.text : JSON.stringify(c)))
                .join("\n");
            }
            return JSON.stringify(result);
          },
        });
      }
    } catch (err) {
      // A single misconfigured MCP server should not break the whole agent
      // loop; skip it and continue with the rest.
      console.error(`Failed to load MCP server "${server.name}":`, err);
    }
  }

  return tools;
}
