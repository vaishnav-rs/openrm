import React, { useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import { getPrisma } from "../../db/prisma.js";
import { TextArea } from "../TextArea.js";

const DEFAULT_PROMPT =
  "You are the WhatsApp assistant for this business. Use your tools to remember " +
  "customer names and interests. Keep replies short and helpful.";

/**
 * Multi-line editor for AgentConfig.masterSystemPrompt (DB-backed singleton
 * row, id="1"). Combined with soul.md by the orchestrator to build the full
 * system prompt on every inbound message.
 */
export function SystemPrompt({ active }: { active: boolean }): React.ReactElement {
  const [content, setContent] = useState("");
  const [status, setStatus] = useState<string | undefined>(undefined);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const prisma = getPrisma();
      const row = await prisma.agentConfig.findUnique({ where: { id: "1" } });
      if (!cancelled) {
        setContent(row?.masterSystemPrompt ?? DEFAULT_PROMPT);
        setLoaded(true);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  useInput(
    (input, key) => {
      if (!active) return;
      if (key.ctrl && (input === "s" || input === "S")) {
        void save();
      }
    },
    { isActive: active }
  );

  async function save() {
    const prisma = getPrisma();
    await prisma.agentConfig.upsert({
      where: { id: "1" },
      update: { masterSystemPrompt: content },
      create: { id: "1", masterSystemPrompt: content },
    });
    setStatus(`Saved at ${new Date().toLocaleTimeString()}`);
  }

  if (!loaded) return <Text dimColor>Loading...</Text>;

  return (
    <Box flexDirection="column">
      <Text bold>Master System Prompt (database-backed)</Text>
      <Box marginTop={1}>
        <TextArea value={content} onChange={setContent} active={active} height={16} />
      </Box>
      <Box marginTop={1}>
        <Text dimColor>Ctrl+S to save{status ? ` -- ${status}` : ""}</Text>
      </Box>
    </Box>
  );
}
