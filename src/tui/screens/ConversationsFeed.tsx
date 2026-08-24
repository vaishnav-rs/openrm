import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";
import { eventBus, type MessageInEvent, type MessageOutEvent } from "../events.js";

interface FeedEntry {
  direction: "in" | "out";
  phone: string;
  text: string;
  at: string;
}

const MAX_ENTRIES = 50;

export function ConversationsFeed(): React.ReactElement {
  const [entries, setEntries] = useState<FeedEntry[]>([]);

  useEffect(() => {
    const onIn = (e: MessageInEvent) =>
      setEntries((prev) =>
        [...prev, { direction: "in" as const, phone: e.phone, text: e.text, at: e.at }].slice(
          -MAX_ENTRIES
        )
      );
    const onOut = (e: MessageOutEvent) =>
      setEntries((prev) =>
        [...prev, { direction: "out" as const, phone: e.phone, text: e.text, at: e.at }].slice(
          -MAX_ENTRIES
        )
      );

    eventBus.onTyped("message:in", onIn);
    eventBus.onTyped("message:out", onOut);
    return () => {
      eventBus.offTyped("message:in", onIn);
      eventBus.offTyped("message:out", onOut);
    };
  }, []);

  return (
    <Box flexDirection="column">
      <Text bold>Conversations (live)</Text>
      <Box marginTop={1} flexDirection="column">
        {entries.length === 0 && <Text dimColor>No messages yet.</Text>}
        {entries.map((e, i) => (
          <Text key={i} color={e.direction === "in" ? "cyan" : "green"}>
            [{new Date(e.at).toLocaleTimeString()}] {e.direction === "in" ? "<-" : "->"}{" "}
            {e.phone}: {e.text}
          </Text>
        ))}
      </Box>
    </Box>
  );
}
