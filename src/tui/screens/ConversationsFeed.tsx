import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";
import { eventBus, type MessageInEvent, type MessageOutEvent } from "../events.js";
import { colors, icons } from "../theme.js";

interface FeedEntry {
  direction: "in" | "out";
  phone: string;
  text: string;
  at: string;
}

const MAX_ENTRIES = 50;
const VISIBLE = 18;

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

  const visible = entries.slice(-VISIBLE);

  return (
    <Box flexDirection="column">
      <Text bold color={colors.text}>
        {icons.msg} Conversations (live)
      </Text>
      <Box marginTop={1} flexDirection="column" flexGrow={1}>
        {entries.length === 0 && <Text dimColor>No messages yet -- this feed streams inbound/outbound events live.</Text>}
        {visible.map((e, i) => {
          const prev = visible[i - 1];
          const newSession = !prev || prev.phone !== e.phone;
          return (
            <Box key={i} flexDirection="column">
              {newSession && (
                <Box marginTop={i === 0 ? 0 : 1}>
                  <Text color={colors.mutedDim}>── {e.phone} ──</Text>
                </Box>
              )}
              <Box justifyContent={e.direction === "out" ? "flex-end" : "flex-start"}>
                <Bubble entry={e} />
              </Box>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

function Bubble({ entry }: { entry: FeedEntry }): React.ReactElement {
  const isOut = entry.direction === "out";
  const time = new Date(entry.at).toLocaleTimeString();
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={isOut ? colors.accent : colors.border}
      paddingX={1}
      width={Math.min(60, Math.max(20, entry.text.length + 4))}
    >
      <Text color={isOut ? colors.accent : colors.textDim}>
        {isOut ? icons.out : icons.in} {isOut ? "openrm" : entry.phone}
      </Text>
      <Text color={isOut ? colors.text : colors.textDim}>{entry.text}</Text>
      <Text color={colors.mutedDim}>{time}</Text>
    </Box>
  );
}
