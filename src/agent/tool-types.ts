import type { ToolDefinition } from "../providers/types.js";

/**
 * Shared context passed to every tool executor, regardless of which module
 * (crm.ts, rag.ts, mcp-client.ts) defined it. `phone` is derived from the
 * inbound WhatsApp JID by the orchestrator -- ground truth, never taken from
 * model output -- so tools can trust it for scoping data to "the customer
 * currently being replied to."
 */
export interface ToolContext {
  phone: string;
  jid: string;
}

export interface AgentTool {
  definition: ToolDefinition;
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string>;
}
