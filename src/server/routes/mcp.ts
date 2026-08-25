import { Router } from "express";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { getPrisma } from "../../db/prisma.js";

/** Mirrors src/tui/screens/McpServers.tsx: CRUD, enable/disable, test connection. */
export function createMcpRouter(): Router {
  const router = Router();

  router.get("/mcp", async (_req, res) => {
    const prisma = getPrisma();
    const rows = await prisma.mcpServer.findMany({ orderBy: { createdAt: "asc" } });
    res.json({ servers: rows });
  });

  router.post("/mcp", async (req, res) => {
    const { name, transport, command, args, url } = req.body ?? {};
    if (typeof name !== "string" || (transport !== "stdio" && transport !== "http")) {
      res.status(400).json({ error: "Requires 'name' and transport in {stdio, http}." });
      return;
    }
    const prisma = getPrisma();
    const row = await prisma.mcpServer.create({
      data: {
        name,
        transport,
        command: command || null,
        args: Array.isArray(args) ? args : [],
        url: url || null,
        enabled: true,
      },
    });
    res.status(201).json({ server: row });
  });

  router.patch("/mcp/:id", async (req, res) => {
    const { name, command, args, url, enabled } = req.body ?? {};
    const prisma = getPrisma();
    try {
      const row = await prisma.mcpServer.update({
        where: { id: req.params.id },
        data: {
          ...(name !== undefined ? { name } : {}),
          ...(command !== undefined ? { command: command || null } : {}),
          ...(Array.isArray(args) ? { args } : {}),
          ...(url !== undefined ? { url: url || null } : {}),
          ...(enabled !== undefined ? { enabled: Boolean(enabled) } : {}),
        },
      });
      res.json({ server: row });
    } catch (err) {
      res.status(404).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.post("/mcp/:id/toggle", async (req, res) => {
    const prisma = getPrisma();
    const row = await prisma.mcpServer.findUnique({ where: { id: req.params.id } });
    if (!row) {
      res.status(404).json({ error: "MCP server not found." });
      return;
    }
    const updated = await prisma.mcpServer.update({ where: { id: row.id }, data: { enabled: !row.enabled } });
    res.json({ ok: true, enabled: updated.enabled });
  });

  router.delete("/mcp/:id", async (req, res) => {
    const prisma = getPrisma();
    try {
      await prisma.mcpServer.delete({ where: { id: req.params.id } });
      res.json({ ok: true });
    } catch (err) {
      res.status(404).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.post("/mcp/:id/test", async (req, res) => {
    const prisma = getPrisma();
    const row = await prisma.mcpServer.findUnique({ where: { id: req.params.id } });
    if (!row) {
      res.status(404).json({ error: "MCP server not found." });
      return;
    }
    try {
      const client = new Client({ name: "openrm", version: "0.1.0" }, { capabilities: {} });
      if (row.transport === "stdio") {
        if (!row.command) throw new Error("No command configured");
        const transport = new StdioClientTransport({ command: row.command, args: row.args });
        await client.connect(transport);
      } else {
        if (!row.url) throw new Error("No url configured");
        const transport = new StreamableHTTPClientTransport(new URL(row.url));
        await client.connect(transport);
      }
      const { tools } = await client.listTools();
      res.json({ ok: true, tools: tools.map((t) => t.name) });
    } catch (err) {
      res.status(502).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  return router;
}
