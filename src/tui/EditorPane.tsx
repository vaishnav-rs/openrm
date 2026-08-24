import React, { useCallback, useState } from "react";
import { Box, Text } from "ink";
import { TextArea, computeScrollTop } from "./TextArea.js";
import { colors, icons } from "./theme.js";

interface EditorPaneProps {
  title: string;
  subtitle?: string;
  value: string;
  onChange: (value: string) => void;
  active: boolean;
  height?: number;
  dirty?: boolean;
  status?: string;
}

/**
 * Framed "editor" chrome shared by Soul and SystemPrompt: title bar,
 * line-numbered gutter, unsaved-changes indicator, and a save-confirmation
 * flash line. Wraps TextArea, which owns the cursor/selection and does the
 * actual key handling.
 *
 * The gutter and TextArea's text rows used to each independently slice
 * `lines` to figure out what's "visible" (`lines.slice(-height)`), which
 * was fine when the editor was append-only (the tail was always what you
 * wanted) but broke once the cursor could move into earlier content -- two
 * independent windowing computations are exactly how this repo previously
 * got a gutter/text desync bug on wrapped lines. To avoid repeating that,
 * `scrollTop` (the first visible line index) is owned here, computed via
 * the *same* `computeScrollTop` helper TextArea itself uses, fed by
 * TextArea's `onCursorLineChange` callback, and then handed back down to
 * TextArea as a controlled prop. Both the gutter below and TextArea's rows
 * are therefore guaranteed -- by construction, not by coincidence -- to
 * render the exact same window.
 */
export function EditorPane({
  title,
  subtitle,
  value,
  onChange,
  active,
  height = 14,
  dirty,
  status,
}: EditorPaneProps): React.ReactElement {
  const [scrollTop, setScrollTop] = useState(0);

  const handleCursorLineChange = useCallback(
    (cursorLine: number, totalLines: number) => {
      setScrollTop((prev) => computeScrollTop(prev, cursorLine, height, totalLines));
    },
    [height]
  );

  const lines = value.split("\n");
  const visibleCount = Math.min(height, Math.max(0, lines.length - scrollTop));
  const startLineNo = scrollTop + 1;
  const gutterWidth = String(lines.length).length + 1;

  return (
    <Box flexDirection="column">
      <Box justifyContent="space-between">
        <Text bold color={colors.text}>
          {icons.edit} {title}
        </Text>
        {dirty && <Text color={colors.warning}>{icons.dotFilled} unsaved changes</Text>}
      </Box>
      {subtitle && <Text dimColor>{subtitle}</Text>}

      <Box marginTop={1} borderStyle="round" borderColor={active ? colors.borderFocus : colors.border}>
        <Box flexDirection="column" paddingX={1} borderStyle="single" borderColor={colors.border} borderTop={false} borderBottom={false} borderRight={true} borderLeft={false}>
          {Array.from({ length: visibleCount }, (_, i) => (
            <Text key={i} color={colors.mutedDim}>
              {String(startLineNo + i).padStart(gutterWidth, " ")}
            </Text>
          ))}
        </Box>
        <Box flexDirection="column" paddingX={1} flexGrow={1}>
          <TextArea
            value={value}
            onChange={onChange}
            active={active}
            height={height}
            bare
            scrollTop={scrollTop}
            onCursorLineChange={handleCursorLineChange}
          />
        </Box>
      </Box>

      <Box marginTop={1}>
        <Text dimColor>
          Ctrl+S save{status ? ` · ${status}` : ""}
        </Text>
      </Box>
    </Box>
  );
}
