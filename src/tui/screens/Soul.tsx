import React, { useEffect, useState } from "react";
import { Box, useInput } from "ink";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { getSoulPath, getOpenrmHome } from "../../setup/paths.js";
import { EditorPane } from "../EditorPane.js";

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
  const [savedContent, setSavedContent] = useState("");
  const [status, setStatus] = useState<string | undefined>(undefined);

  useEffect(() => {
    const path = getSoulPath();
    const initial = existsSync(path) ? readFileSync(path, "utf-8") : loadDefaultSoul();
    setContent(initial);
    setSavedContent(initial);
  }, []);

  useInput(
    (input, key) => {
      if (!active) return;
      if (key.ctrl && (input === "s" || input === "S")) {
        const home = getOpenrmHome();
        if (!existsSync(home)) mkdirSync(home, { recursive: true });
        writeFileSync(getSoulPath(), content, "utf-8");
        setSavedContent(content);
        setStatus(`saved at ${new Date().toLocaleTimeString()}`);
      }
    },
    { isActive: active }
  );

  return (
    <Box flexDirection="column">
      <EditorPane
        title="Soul"
        subtitle="Persona & behavior seed -- ~/.openrm/soul.md"
        value={content}
        onChange={setContent}
        active={active}
        height={16}
        dirty={content !== savedContent}
        status={status}
      />
    </Box>
  );
}
