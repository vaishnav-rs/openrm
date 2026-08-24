import React from "react";
import { Box, Text } from "ink";
import { TextArea } from "./TextArea.js";
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
 * flash line. Wraps the existing TextArea (unchanged input semantics).
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
  const lines = value.split("\n");
  const visible = lines.slice(-height);
  const startLineNo = lines.length - visible.length + 1;
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
          {visible.map((_, i) => (
            <Text key={i} color={colors.mutedDim}>
              {String(startLineNo + i).padStart(gutterWidth, " ")}
            </Text>
          ))}
        </Box>
        <Box flexDirection="column" paddingX={1} flexGrow={1}>
          <RawEditorLines value={value} onChange={onChange} active={active} height={height} />
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

/** Thin wrapper so we keep using TextArea's exact input handling, just unstyled (no border) for embedding in EditorPane's frame. */
function RawEditorLines({
  value,
  onChange,
  active,
  height,
}: {
  value: string;
  onChange: (v: string) => void;
  active: boolean;
  height: number;
}): React.ReactElement {
  return <TextArea value={value} onChange={onChange} active={active} height={height} bare />;
}
