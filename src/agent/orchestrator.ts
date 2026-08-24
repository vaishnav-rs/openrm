import { readFileSync } from "node:fs";
import { getPrisma } from "../db/prisma.js";
import { getActiveProvider } from "../providers/registry.js";
import type { ChatMessage, ToolDefinition } from "../providers/types.js";
import { getSoulPath } from "../setup/paths.js";
import { crmTools } from "./tools/crm.js";
import { ragTools } from "./tools/rag.js";
import { loadMcpTools } from "./mcp-client.js";
import type { AgentTool, ToolContext } from "./tool-types.js";

const MAX_HISTORY_MESSAGES = 20;
const MAX_TOOL_ITERATIONS = 6;

/** Extracts the bare phone number from a WhatsApp JID like "15551234567@s.whatsapp.net". */
export function parsePhoneFromJid(jid: string): string {
  return jid.split("@")[0].split(":")[0];
}

function loadSoul(): string {
  try {
    return readFileSync(getSoulPath(), "utf-8");
  } catch {
    return "";
  }
}

async function loadMasterSystemPrompt(): Promise<string> {
  const prisma = getPrisma();
  const config = await prisma.agentConfig.findUnique({ where: { id: "1" } });
  return config?.masterSystemPrompt ?? "";
}

async function getOrCreateConversation(contactId: string) {
  const prisma = getPrisma();
  const existing = await prisma.conversation.findFirst({
    where: { contactId },
    orderBy: { createdAt: "desc" },
  });
  if (existing) return existing;
  return prisma.conversation.create({ data: { contactId } });
}

/**
 * Handles one inbound message: resolves/creates the Contact + Conversation,
 * persists the user message, runs the provider's tool-calling loop against a
 * system prompt built fresh from soul.md + AgentConfig.masterSystemPrompt,
 * persists the assistant's final reply, and returns the reply text.
 *
 * This function never sends anything over WhatsApp itself -- it only
 * computes a reply. The caller (src/whatsapp/handlers.ts) is responsible for
 * actually calling sock.sendMessage with the returned text.
 */
export async function handleInbound(jid: string, text: string): Promise<string> {
  const prisma = getPrisma();
  const phone = parsePhoneFromJid(jid);

  const contact = await prisma.contact.upsert({
    where: { phone },
    update: {},
    create: { phone },
  });

  const conversation = await getOrCreateConversation(contact.id);

  await prisma.message.create({
    data: { conversationId: conversation.id, role: "user", content: text },
  });

  const soul = loadSoul();
  const masterSystemPrompt = await loadMasterSystemPrompt();
  const systemPrompt = [soul, masterSystemPrompt].filter(Boolean).join("\n\n");

  const history = await prisma.message.findMany({
    where: { conversationId: conversation.id },
    orderBy: { createdAt: "desc" },
    take: MAX_HISTORY_MESSAGES,
  });
  history.reverse();

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    ...history.map(
      (m): ChatMessage => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: m.content,
      })
    ),
  ];

  const mcpTools = await loadMcpTools();
  const allTools: AgentTool[] = [...crmTools, ...ragTools, ...mcpTools];
  const toolByName = new Map(allTools.map((t) => [t.definition.name, t]));
  const toolDefs: ToolDefinition[] = allTools.map((t) => t.definition);

  const provider = await getActiveProvider();
  const ctx: ToolContext = { phone, jid };

  let finalText = "";
  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
    const result = await provider.chat(messages, toolDefs);

    if (result.toolCalls && result.toolCalls.length > 0) {
      messages.push({
        role: "assistant",
        content: result.content ?? "",
        toolCalls: result.toolCalls,
      });

      for (const call of result.toolCalls) {
        const tool = toolByName.get(call.name);
        let output: string;
        if (!tool) {
          output = `Unknown tool: ${call.name}`;
        } else {
          try {
            output = await tool.execute(call.arguments, ctx);
          } catch (err) {
            output = `Tool "${call.name}" failed: ${
              err instanceof Error ? err.message : String(err)
            }`;
          }
        }
        messages.push({
          role: "tool",
          content: output,
          toolCallId: call.id,
          toolName: call.name,
        });
      }
      continue;
    }

    finalText = result.content ?? "";
    break;
  }

  if (!finalText) {
    finalText =
      "Sorry, I'm having trouble putting together a reply right now -- please try again in a moment.";
  }

  await prisma.message.create({
    data: { conversationId: conversation.id, role: "assistant", content: finalText },
  });

  return finalText;
}
