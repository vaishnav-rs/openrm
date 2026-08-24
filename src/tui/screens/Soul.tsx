import React, { useEffect, useState } from "react";
import { Box, useInput } from "ink";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { getSoulPath, getOpenrmHome } from "../../setup/paths.js";
import { EditorPane } from "../EditorPane.js";
import { shellGeometry } from "../theme.js";
import { useClickRegions } from "../clickRegions.js";

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
const EDITOR_HEIGHT = 16;

export function Soul({
  active,
  onActivate,
}: {
  active: boolean;
  onActivate?: () => void;
}): React.ReactElement {
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

  // Click region: the whole editor block (title through the textarea's
  // bordered box) is a single clickable target that just focuses this
  // screen -- there's no sub-mode to switch here (the editor is the only
  // thing on this screen, so it's already the active TextArea whenever the
  // screen itself has focus). Row math mirrors EditorPane's own render
  // structure: title, subtitle, a marginTop blank row, then the bordered
  // box (border + `height` content rows + border).
  const editorBottomRow = shellGeometry.screenTopRow + 2 /* subtitle + blank */ + 1 /* border top */ + EDITOR_HEIGHT;
  useClickRegions(
    [
      {
        rowStart: shellGeometry.screenTopRow,
        rowEnd: editorBottomRow,
        colStart: shellGeometry.screenLeftCol,
        colEnd: 9999,
        onClick: () => onActivate?.(),
      },
    ],
    true
  );

  return (
    <Box flexDirection="column">
      <EditorPane
        title="Soul"
        subtitle="Persona & behavior seed -- ~/.openrm/soul.md"
        value={content}
        onChange={setContent}
        active={active}
        height={EDITOR_HEIGHT}
        dirty={content !== savedContent}
        status={status}
      />
    </Box>
  );
}
