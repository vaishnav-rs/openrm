import React, { useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { getSoulPath, getOpenrmHome } from "../../setup/paths.js";
import { TextArea } from "../TextArea.js";

function loadDefaultSoul(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "..", "..", "..", "templates", "soul.default.md"),
    join(here, "..", "..", "..", "..", "templates", "soul.default.md"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return readFileSync(c, "utf-8");
  }
  return "# Soul\n\nYou are a helpful, concise customer-facing WhatsApp assistant.\n";
}

/**
 * Loads/saves ~/.openrm/soul.md directly (not the database). soul.md is
 * loaded fresh from disk on every inbound message by the orchestrator, so
 * saving here takes effect on the very next reply.
 */
export function Soul({ active }: { active: boolean }): React.ReactElement {
  const [content, setContent] = useState("");
  const [status, setStatus] = useState<string | undefined>(undefined);

  useEffect(() => {
    const path = getSoulPath();
    if (existsSync(path)) {
      setContent(readFileSync(path, "utf-8"));
    } else {
      setContent(loadDefaultSoul());
    }
  }, []);

  useInput(
    (input, key) => {
      if (!active) return;
      if (key.ctrl && (input === "s" || input === "S")) {
        const home = getOpenrmHome();
        if (!existsSync(home)) mkdirSync(home, { recursive: true });
        writeFileSync(getSoulPath(), content, "utf-8");
        setStatus(`Saved at ${new Date().toLocaleTimeString()}`);
      }
    },
    { isActive: active }
  );

  return (
    <Box flexDirection="column">
      <Text bold>Soul (persona &amp; behavior seed -- ~/.openrm/soul.md)</Text>
      <Box marginTop={1}>
        <TextArea value={content} onChange={setContent} active={active} height={16} />
      </Box>
      <Box marginTop={1}>
        <Text dimColor>Ctrl+S to save{status ? ` -- ${status}` : ""}</Text>
      </Box>
    </Box>
  );
}
