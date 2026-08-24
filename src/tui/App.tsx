import React, { useEffect, useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import { Dashboard } from "./screens/Dashboard.js";
import { Pairing } from "./screens/Pairing.js";
import { ConversationsFeed } from "./screens/ConversationsFeed.js";
import { Contacts } from "./screens/Contacts.js";
import { Providers } from "./screens/Providers.js";
import { Soul } from "./screens/Soul.js";
import { SystemPrompt } from "./screens/SystemPrompt.js";
import { RagDocuments } from "./screens/RagDocuments.js";
import { McpServers } from "./screens/McpServers.js";
import { eventBus, type WaStatus } from "./events.js";
import { colors, icons, layout, waStatusColor, waStatusLabel } from "./theme.js";
import { getPrisma } from "../db/prisma.js";

interface NavItem {
  key: string;
  label: string;
  icon: string;
}
interface NavGroup {
  title: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    title: "MONITOR",
    items: [
      { key: "dashboard", label: "Dashboard", icon: icons.diamond },
      { key: "pairing", label: "Pairing", icon: icons.qr },
      { key: "conversations", label: "Conversations", icon: icons.msg },
    ],
  },
  {
    title: "DATA",
    items: [{ key: "contacts", label: "Contacts", icon: icons.contact }],
  },
  {
    title: "CONFIGURE",
    items: [
      { key: "providers", label: "Providers", icon: icons.plug },
      { key: "soul", label: "Soul", icon: icons.edit },
      { key: "system-prompt", label: "System Prompt", icon: icons.gear },
    ],
  },
  {
    title: "KNOWLEDGE",
    items: [
      { key: "rag", label: "RAG Documents", icon: icons.book },
      { key: "mcp", label: "MCP Servers", icon: icons.server },
    ],
  },
];

const FLAT_ITEMS: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);
type ScreenKey = string;

interface ProviderInfo {
  name: string;
  model: string;
}

function useClock(): string {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now.toLocaleTimeString();
}

function usePulse(active: boolean): boolean {
  const [on, setOn] = useState(true);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setOn((v) => !v), 500);
    return () => clearInterval(id);
  }, [active]);
  return active ? on : true;
}

function useStats() {
  const [contactCount, setContactCount] = useState<number | undefined>(undefined);
  const [messagesToday, setMessagesToday] = useState<number | undefined>(undefined);
  const [provider, setProvider] = useState<ProviderInfo | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const prisma = getPrisma();
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        const [contacts, messages, activeProvider] = await Promise.all([
          prisma.contact.count(),
          prisma.message.count({ where: { createdAt: { gte: startOfDay } } }),
          prisma.providerConfig.findFirst({ where: { isActive: true } }),
        ]);
        if (!cancelled) {
          setContactCount(contacts);
          setMessagesToday(messages);
          setProvider(activeProvider ? { name: activeProvider.name, model: activeProvider.model } : undefined);
        }
      } catch {
        // DB may not be reachable yet.
      }
    }
    void load();
    const id = setInterval(load, 4000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return { contactCount, messagesToday, provider };
}

export function App(): React.ReactElement {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [focus, setFocus] = useState<"nav" | "screen">("nav");
  const [waStatus, setWaStatus] = useState<WaStatus>("idle");
  const active: ScreenKey = FLAT_ITEMS[selectedIndex].key;
  const clock = useClock();
  const { contactCount, messagesToday, provider } = useStats();
  const pulseOn = usePulse(waStatus === "connecting" || waStatus === "qr");

  useEffect(() => {
    const onStatus = ({ status }: { status: WaStatus }) => setWaStatus(status);
    eventBus.onTyped("wa:status", onStatus);
    return () => {
      eventBus.offTyped("wa:status", onStatus);
    };
  }, []);

  useInput((input, key) => {
    if (focus === "nav") {
      if (key.upArrow) {
        setSelectedIndex((i) => (i - 1 + FLAT_ITEMS.length) % FLAT_ITEMS.length);
      } else if (key.downArrow) {
        setSelectedIndex((i) => (i + 1) % FLAT_ITEMS.length);
      } else if (key.return || key.rightArrow) {
        setFocus("screen");
      }
    } else {
      if (key.escape || (input === "q" && key.shift === false)) {
        setFocus("nav");
      } else if (key.leftArrow) {
        setFocus("nav");
      }
    }
  });

  const rows = process.stdout.rows ?? 32;

  const statusDotColor = waStatusColor[waStatus] ?? colors.muted;
  const showDot = waStatus === "connecting" || waStatus === "qr" ? pulseOn : true;

  return (
    <Box flexDirection="column" height={rows}>
      {/* Top status bar */}
      <Box
        flexDirection="row"
        justifyContent="space-between"
        paddingX={1}
        borderStyle="round"
        borderColor={colors.border}
        flexShrink={0}
      >
        <Box flexDirection="row" gap={1}>
          <Text bold color={colors.accent}>
            {icons.bolt} {icons.wordmark}
          </Text>
          <Text dimColor>│</Text>
          <Text color={showDot ? statusDotColor : colors.mutedDim}>{icons.dotFilled}</Text>
          <Text color={colors.textDim}>{waStatusLabel[waStatus] ?? waStatus}</Text>
        </Box>
        <Box flexDirection="row" gap={1}>
          <Text color={colors.textDim}>
            {icons.gear} {provider ? `${provider.name}:${provider.model}` : "no provider"}
          </Text>
          <Text dimColor>│</Text>
          <Text color={colors.textDim}>
            {icons.contact} {contactCount ?? "…"}
          </Text>
          <Text color={colors.textDim}>
            {icons.msg} {messagesToday ?? "…"} today
          </Text>
          <Text dimColor>│</Text>
          <Text color={colors.muted}>{clock}</Text>
        </Box>
      </Box>

      {/* Body: nav + screen */}
      <Box flexDirection="row" flexGrow={1}>
        <Box
          flexDirection="column"
          width={layout.navWidth}
          borderStyle="round"
          borderColor={focus === "nav" ? colors.borderFocus : colors.border}
          paddingX={1}
          flexShrink={0}
        >
          {NAV_GROUPS.map((group) => (
            <Box key={group.title} flexDirection="column" marginBottom={1}>
              <Text color={colors.mutedDim}>{group.title}</Text>
              {group.items.map((item) => {
                const globalIndex = FLAT_ITEMS.indexOf(item);
                const isSelected = globalIndex === selectedIndex;
                const bar = isSelected ? (focus === "nav" ? icons.arrowRight : icons.chevron) : " ";
                const labelColor = isSelected
                  ? focus === "nav"
                    ? colors.accent
                    : colors.text
                  : colors.textDim;
                return (
                  <Text key={item.key} bold={isSelected} color={labelColor}>
                    {bar} {item.icon} {item.label}
                  </Text>
                );
              })}
            </Box>
          ))}
        </Box>

        <Box
          flexDirection="column"
          flexGrow={1}
          borderStyle="round"
          borderColor={focus === "screen" ? colors.borderFocus : colors.border}
          paddingX={2}
          paddingY={1}
          overflow="hidden"
        >
          <ActiveScreen screen={active} active={focus === "screen"} />
        </Box>
      </Box>

      {/* Bottom help bar */}
      <Box paddingX={1} justifyContent="space-between" flexShrink={0}>
        <Text color={colors.mutedDim}>
          {focus === "nav"
            ? `${icons.caretUp}${icons.caretDown} navigate  ↵/→ open pane`
            : "esc/q/← back to nav  (see pane for keys)"}
        </Text>
        <Text color={colors.mutedDim}>
          openrm never initiates WhatsApp messages -- reactive only
        </Text>
      </Box>
    </Box>
  );
}

function ActiveScreen({
  screen,
  active,
}: {
  screen: ScreenKey;
  active: boolean;
}): React.ReactElement {
  switch (screen) {
    case "dashboard":
      return <Dashboard />;
    case "pairing":
      return <Pairing />;
    case "conversations":
      return <ConversationsFeed />;
    case "contacts":
      return <Contacts active={active} />;
    case "providers":
      return <Providers active={active} />;
    case "soul":
      return <Soul active={active} />;
    case "system-prompt":
      return <SystemPrompt active={active} />;
    case "rag":
      return <RagDocuments active={active} />;
    case "mcp":
      return <McpServers active={active} />;
    default:
      return <Text>Unknown screen</Text>;
  }
}
