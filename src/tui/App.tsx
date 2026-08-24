import React, { useState } from "react";
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

const NAV_ITEMS = [
  { key: "dashboard", label: "Dashboard" },
  { key: "pairing", label: "Pairing" },
  { key: "conversations", label: "Conversations" },
  { key: "contacts", label: "Contacts" },
  { key: "providers", label: "Providers" },
  { key: "soul", label: "Soul" },
  { key: "system-prompt", label: "System Prompt" },
  { key: "rag", label: "RAG Documents" },
  { key: "mcp", label: "MCP Servers" },
] as const;

type ScreenKey = (typeof NAV_ITEMS)[number]["key"];

export function App(): React.ReactElement {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [focus, setFocus] = useState<"nav" | "screen">("nav");
  const active: ScreenKey = NAV_ITEMS[selectedIndex].key;

  useInput((input, key) => {
    if (focus === "nav") {
      if (key.upArrow) {
        setSelectedIndex((i) => (i - 1 + NAV_ITEMS.length) % NAV_ITEMS.length);
      } else if (key.downArrow) {
        setSelectedIndex((i) => (i + 1) % NAV_ITEMS.length);
      } else if (key.return) {
        setFocus("screen");
      }
    } else {
      if (key.escape || input === "q") {
        setFocus("nav");
      }
    }
  });

  return (
    <Box flexDirection="row" height={process.stdout.rows ?? 30}>
      <Box flexDirection="column" width={24} borderStyle="round" paddingX={1}>
        <Text bold color="green">
          openrm
        </Text>
        <Box marginTop={1} flexDirection="column">
          {NAV_ITEMS.map((item, i) => (
            <Text
              key={item.key}
              color={i === selectedIndex ? "black" : focus === "nav" ? "white" : "gray"}
              backgroundColor={i === selectedIndex ? "green" : undefined}
            >
              {i === selectedIndex ? "> " : "  "}
              {item.label}
            </Text>
          ))}
        </Box>
        <Box marginTop={1}>
          <Text dimColor>
            {focus === "nav" ? "↑/↓ select, Enter open" : "Esc/q back to nav"}
          </Text>
        </Box>
      </Box>
      <Box flexDirection="column" flexGrow={1} borderStyle="round" paddingX={1}>
        <ActiveScreen screen={active} active={focus === "screen"} />
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
