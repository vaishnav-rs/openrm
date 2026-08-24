import React from "react";
import { Box, Text, useInput } from "ink";

interface TextAreaProps {
  value: string;
  onChange: (value: string) => void;
  active: boolean;
  height?: number;
  /** When true, renders without its own border/padding -- for embedding inside a custom frame (e.g. EditorPane). */
  bare?: boolean;
}

/**
 * Minimal multi-line text editor built directly on Ink's useInput. Enter
 * inserts a newline; Backspace deletes a character; Ctrl+S is left to the
 * parent screen to handle as "save" (not consumed here).
 */
export function TextArea({ value, onChange, active, height = 15, bare = false }: TextAreaProps): React.ReactElement {
  useInput(
    (input, key) => {
      if (!active) return;
      if (key.ctrl && (input === "s" || input === "S")) return; // let parent handle save
      if (key.return) {
        onChange(value + "\n");
        return;
      }
      if (key.backspace || key.delete) {
        onChange(value.slice(0, -1));
        return;
      }
      if (key.ctrl || key.meta) return;
      if (input) {
        onChange(value + input);
      }
    },
    { isActive: active }
  );

  const lines = value.split("\n");
  const visibleLines = lines.slice(-height);

  if (bare) {
    return (
      <Box flexDirection="column" height={height}>
        {visibleLines.map((line, i) => (
          <Text key={i}>{line || " "}</Text>
        ))}
      </Box>
    );
  }

  return (
    <Box flexDirection="column" borderStyle="single" paddingX={1} height={height + 2}>
      {visibleLines.map((line, i) => (
        <Text key={i}>{line || " "}</Text>
      ))}
    </Box>
  );
}
