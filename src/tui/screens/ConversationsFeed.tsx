import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";
import { getPrisma } from "../../db/prisma.js";
import { eventBus, type MessageInEvent, type MessageOutEvent } from "../events.js";
import { colors, icons } from "../theme.js";
import { scaledInterval } from "../terminal-env.js";

interface FeedEntry {
  direction: "in" | "out";
  phone: string;
  text: string;
  at: string;
}

interface NeedsHumanRow {
  id: string;
  phone: string;
  name: string | null;
  escalatedAt: Date | null;
}

const MAX_ENTRIES = 50;
const VISIBLE = 18;
const HISTORY_LIMIT = 100;
const NEEDS_HUMAN_POLL_MS = 4000;

/**
 * Loads the last HISTORY_LIMIT persisted messages (joined through
 * Conversation -> Contact for the phone number) so the feed shows real
 * history immediately on mount, instead of staying empty until a new
 * message happens to arrive while this screen is open (the bug this fixes
 * -- previously entries were populated purely by live events).
 */
async function loadRecentHistory(): Promise<FeedEntry[]> {
  const prisma = getPrisma();
  const messages = await prisma.message.findMany({
    where: { role: { in: ["user", "assistant"] } },
    orderBy: { createdAt: "desc" },
    take: HISTORY_LIMIT,
    include: { conversation: { include: { contact: true } } },
  });
  messages.reverse();
  return messages.map((m) => ({
    direction: m.role === "user" ? ("in" as const) : ("out" as const),
    phone: m.conversation.contact.phone,
    text: m.content,
    at: m.createdAt.toISOString(),
  }));
}

async function loadNeedsHuman(): Promise<NeedsHumanRow[]> {
  const prisma = getPrisma();
  const rows = await prisma.conversation.findMany({
    where: { needsHuman: true },
    orderBy: { escalatedAt: "desc" },
    include: { contact: true },
    take: 20,
  });
  return rows.map((r) => ({
    id: r.id,
    phone: r.contact.phone,
    name: r.contact.name,
    escalatedAt: r.escalatedAt,
  }));
}

export function ConversationsFeed(): React.ReactElement {
  const [entries, setEntries] = useState<FeedEntry[]>([]);
  const [needsHuman, setNeedsHuman] = useState<NeedsHumanRow[]>([]);

  // Seed from DB history once on mount, then keep appending live events on
  // top exactly as before. Live events only fire for messages that happen
  // after this point, so there's no overlap in the normal case.
  useEffect(() => {
    let cancelled = false;
    void loadRecentHistory().then((history) => {
      if (!cancelled) setEntries((prev) => [...history, ...prev].slice(-MAX_ENTRIES));
    });
    return () => {
      cancelled = true;
    };
  }, []);

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

  // "Needs human" is a DB-backed live list. Polling is the robust source of
  // truth; conversation:escalated is just an extra hint to refresh sooner.
  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      const rows = await loadNeedsHuman();
      if (!cancelled) setNeedsHuman(rows);
    }
    void refresh();
    const interval = setInterval(() => void refresh(), scaledInterval(NEEDS_HUMAN_POLL_MS));
    const onEscalated = () => void refresh();
    eventBus.onTyped("conversation:escalated", onEscalated);
    return () => {
      cancelled = true;
      clearInterval(interval);
      eventBus.offTyped("conversation:escalated", onEscalated);
    };
  }, []);

  const visible = entries.slice(-VISIBLE);

  return (
    <Box flexDirection="column">
      <Text bold color={colors.text}>
        {icons.msg} Conversations (live)
      </Text>

      {needsHuman.length > 0 && (
        <Box
          marginTop={1}
          flexDirection="column"
          borderStyle="round"
          borderColor={colors.error}
          paddingX={1}
        >
          <Text bold color={colors.error}>
            {icons.bolt} NEEDS HUMAN ({needsHuman.length})
          </Text>
          {needsHuman.map((r) => (
            <Text key={r.id} color={colors.error}>
              {icons.bullet} {r.name ?? "(no name)"} -- {r.phone}
              <Text color={colors.textDim}> ({timeAgo(r.escalatedAt)})</Text>
            </Text>
          ))}
        </Box>
      )}

      <Box marginTop={1} flexDirection="column" flexGrow={1}>
        {entries.length === 0 && <Text dimColor>No messages yet.</Text>}
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

function timeAgo(date: Date | null): string {
  if (!date) return "unknown";
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
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
