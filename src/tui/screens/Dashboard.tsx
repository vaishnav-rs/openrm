import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";
import { getPrisma } from "../../db/prisma.js";
import { eventBus, type WaStatus } from "../events.js";

export function Dashboard(): React.ReactElement {
  const [status, setStatus] = useState<WaStatus>("idle");
  const [contactCount, setContactCount] = useState<number | undefined>(undefined);
  const [messageCount, setMessageCount] = useState<number | undefined>(undefined);

  useEffect(() => {
    const onStatus = ({ status }: { status: WaStatus }) => setStatus(status);
    eventBus.onTyped("wa:status", onStatus);

    let cancelled = false;
    async function loadStats() {
      try {
        const prisma = getPrisma();
        const [contacts, messages] = await Promise.all([
          prisma.contact.count(),
          prisma.message.count(),
        ]);
        if (!cancelled) {
          setContactCount(contacts);
          setMessageCount(messages);
        }
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
    };
  }, []);

  return (
    <Box flexDirection="column">
      <Text bold>Dashboard</Text>
      <Box marginTop={1} flexDirection="column">
        <Text>
          WhatsApp connection: <StatusBadge status={status} />
        </Text>
        <Text>Contacts: {contactCount ?? "..."}</Text>
        <Text>Messages: {messageCount ?? "..."}</Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>
          openrm only ever replies to inbound WhatsApp messages -- it never starts a
          conversation.
        </Text>
      </Box>
    </Box>
  );
}

function StatusBadge({ status }: { status: WaStatus }): React.ReactElement {
  const colorMap: Record<WaStatus, string> = {
    idle: "gray",
    connecting: "yellow",
    qr: "yellow",
    connected: "green",
    disconnected: "red",
    logged_out: "red",
  };
  return <Text color={colorMap[status]}>{status}</Text>;
}
