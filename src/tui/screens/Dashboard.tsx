import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";
import { getPrisma } from "../../db/prisma.js";
import { eventBus, type MessageInEvent, type MessageOutEvent, type WaStatus } from "../events.js";
import { colors, icons, sparkline, waStatusColor, waStatusLabel } from "../theme.js";

const BUCKETS = 24; // last 24 hours

interface ActivityEntry {
  direction: "in" | "out";
  phone: string;
  text: string;
  at: string;
}

export function Dashboard(): React.ReactElement {
  const [status, setStatus] = useState<WaStatus>("idle");
  const [contactCount, setContactCount] = useState<number | undefined>(undefined);
  const [messageCount, setMessageCount] = useState<number | undefined>(undefined);
  const [buckets, setBuckets] = useState<number[]>(Array(BUCKETS).fill(0));
  const [provider, setProvider] = useState<{ name: string; model: string; isActive: boolean } | undefined>(
    undefined
  );
  const [activity, setActivity] = useState<ActivityEntry[]>([]);

  useEffect(() => {
    const onStatus = ({ status }: { status: WaStatus }) => setStatus(status);
    const onIn = (e: MessageInEvent) =>
      setActivity((prev) =>
        [{ direction: "in" as const, phone: e.phone, text: e.text, at: e.at }, ...prev].slice(0, 8)
      );
    const onOut = (e: MessageOutEvent) =>
      setActivity((prev) =>
        [{ direction: "out" as const, phone: e.phone, text: e.text, at: e.at }, ...prev].slice(0, 8)
      );
    eventBus.onTyped("wa:status", onStatus);
    eventBus.onTyped("message:in", onIn);
    eventBus.onTyped("message:out", onOut);

    let cancelled = false;
    async function loadStats() {
      try {
        const prisma = getPrisma();
        const now = new Date();
        const dayAgo = new Date(now.getTime() - BUCKETS * 60 * 60 * 1000);
        const [contacts, messages, activeProvider, recentMessages] = await Promise.all([
          prisma.contact.count(),
          prisma.message.count(),
          prisma.providerConfig.findFirst({ where: { isActive: true } }),
          prisma.message.findMany({
            where: { createdAt: { gte: dayAgo } },
            select: { createdAt: true },
          }),
        ]);
        if (cancelled) return;
        setContactCount(contacts);
        setMessageCount(messages);
        setProvider(
          activeProvider
            ? { name: activeProvider.name, model: activeProvider.model, isActive: true }
            : undefined
        );
        const counts = Array(BUCKETS).fill(0);
        for (const m of recentMessages) {
          const hoursAgo = Math.floor((now.getTime() - m.createdAt.getTime()) / (60 * 60 * 1000));
          const idx = BUCKETS - 1 - hoursAgo;
          if (idx >= 0 && idx < BUCKETS) counts[idx]++;
        }
        setBuckets(counts);
      } catch {
        // DB may not be reachable yet; leave counts as undefined.
      }
    }
    void loadStats();
    const interval = setInterval(loadStats, 5000);

    return () => {
      cancelled = true;
      clearInterval(interval);
      eventBus.offTyped("wa:status", onStatus);
      eventBus.offTyped("message:in", onIn);
      eventBus.offTyped("message:out", onOut);
    };
  }, []);

  return (
    <Box flexDirection="column">
      <Text bold color={colors.text}>
        {icons.diamond} Dashboard
      </Text>

      <Box marginTop={1} flexDirection="row" gap={2}>
        <Panel title="WhatsApp">
          <Text>
            <Text color={waStatusColor[status]}>{icons.dotFilled}</Text> {waStatusLabel[status] ?? status}
          </Text>
        </Panel>
        <Panel title="Provider">
          {provider ? (
            <Text>
              <Text color={colors.success}>{icons.check}</Text> {provider.name} <Text color={colors.textDim}>({provider.model})</Text>
            </Text>
          ) : (
            <Text color={colors.warning}>{icons.cross} none active</Text>
          )}
        </Panel>
        <Panel title="Contacts">
          <Text color={colors.accent} bold>
            {contactCount ?? "…"}
          </Text>
        </Panel>
        <Panel title="Messages">
          <Text color={colors.accent} bold>
            {messageCount ?? "…"}
          </Text>
        </Panel>
      </Box>

      <Box marginTop={1} flexDirection="column" borderStyle="round" borderColor={colors.border} paddingX={1}>
        <Text color={colors.mutedDim}>MESSAGE VOLUME · last 24h</Text>
        <Text color={colors.accentAlt}>{sparkline(buckets) || " "}</Text>
      </Box>

      <Box marginTop={1} flexDirection="column" borderStyle="round" borderColor={colors.border} paddingX={1} flexGrow={1}>
        <Text color={colors.mutedDim}>RECENT ACTIVITY</Text>
        {activity.length === 0 && <Text dimColor>Nothing yet -- waiting for inbound messages.</Text>}
        {activity.map((e, i) => (
          <Text key={i} color={e.direction === "in" ? colors.info : colors.success}>
            {e.direction === "in" ? icons.in : icons.out} [{new Date(e.at).toLocaleTimeString()}] {e.phone}: {e.text}
          </Text>
        ))}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>openrm only ever replies to inbound WhatsApp messages -- it never starts a conversation.</Text>
      </Box>
    </Box>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }): React.ReactElement {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={colors.border} paddingX={1} width={20}>
      <Text color={colors.mutedDim}>{title}</Text>
      {children}
    </Box>
  );
}
