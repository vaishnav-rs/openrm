import React, { useEffect, useState } from "react";
import { Text, useInput } from "ink";
import { colors } from "./theme.js";
import { useTextCapture } from "./mouse.js";

interface TextInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit?: (value: string) => void;
  active: boolean;
  placeholder?: string;
  mask?: boolean;
}

/**
 * Single-line text input, built directly on Ink's useInput. Tracks a flat
 * `cursor: number` index into `value` (same single-source-of-truth
 * approach as TextArea, just without the line/column derivation or
 * scrolling TextArea needs -- callers of this component (RAG file paths,
 * provider config fields, the escalation phone field) are all short,
 * single-line values, so no horizontal scroll-into-view has been built;
 * the cursor can still move anywhere in the value, it just isn't windowed).
 *
 * See TextArea.tsx's doc comment for the confirmed Ink key-binding
 * behavior (arrow keys, Ctrl+A/E, the Shift+Arrow selection caveat, and
 * the backspace/delete ambiguity) -- all of it applies identically here.
 */
export function TextInput({
  value,
  onChange,
  onSubmit,
  active,
  placeholder,
  mask,
}: TextInputProps): React.ReactElement {
  const [cursor, setCursor] = useState(value.length);
  const [selectionAnchor, setSelectionAnchor] = useState<number | null>(null);

  useEffect(() => {
    setCursor((c) => Math.min(c, value.length));
  }, [value.length]);

  // See src/tui/mouse.ts for why this is required: SGR mouse mode must stay
  // disabled for as long as this field is actively capturing keystrokes.
  useTextCapture(active);

  useInput(
    (input, key) => {
      if (!active) return;

      const hasSelection = selectionAnchor !== null && selectionAnchor !== cursor;

      function deleteSelection(): { newValue: string; newCursor: number } {
        const start = Math.min(selectionAnchor as number, cursor);
        const end = Math.max(selectionAnchor as number, cursor);
        return { newValue: value.slice(0, start) + value.slice(end), newCursor: start };
      }

      if (key.shift && (key.leftArrow || key.rightArrow)) {
        const anchor = selectionAnchor === null ? cursor : selectionAnchor;
        const newCursor = key.leftArrow ? Math.max(0, cursor - 1) : Math.min(value.length, cursor + 1);
        setSelectionAnchor(anchor);
        setCursor(newCursor);
        return;
      }

      if (key.leftArrow) {
        setSelectionAnchor(null);
        setCursor(Math.max(0, cursor - 1));
        return;
      }
      if (key.rightArrow) {
        setSelectionAnchor(null);
        setCursor(Math.min(value.length, cursor + 1));
        return;
      }

      if (key.ctrl && (input === "a" || input === "A")) {
        setSelectionAnchor(null);
        setCursor(0);
        return;
      }
      if (key.ctrl && (input === "e" || input === "E")) {
        setSelectionAnchor(null);
        setCursor(value.length);
        return;
      }

      if (key.return) {
        onSubmit?.(value);
        return;
      }

      if (key.backspace || key.delete) {
        if (hasSelection) {
          const { newValue, newCursor } = deleteSelection();
          onChange(newValue);
          setCursor(newCursor);
          setSelectionAnchor(null);
        } else if (cursor > 0) {
          onChange(value.slice(0, cursor - 1) + value.slice(cursor));
          setCursor(cursor - 1);
        }
        return;
      }

      if (key.ctrl || key.meta) return;

      if (input) {
        if (hasSelection) {
          const { newValue, newCursor } = deleteSelection();
          onChange(newValue.slice(0, newCursor) + input + newValue.slice(newCursor));
          setCursor(newCursor + input.length);
          setSelectionAnchor(null);
        } else {
          onChange(value.slice(0, cursor) + input + value.slice(cursor));
          setCursor(cursor + input.length);
        }
      }
    },
    { isActive: active }
  );

  if (!value) {
    if (!active) return <Text color="gray">{placeholder || " "}</Text>;
    return (
      <Text>
        <Text inverse> </Text>
        <Text color="gray">{placeholder || ""}</Text>
      </Text>
    );
  }

  const display = mask ? "*".repeat(value.length) : value;
  const hasActiveSelection = selectionAnchor !== null && selectionAnchor !== cursor;

  if (!active) {
    return <Text>{display}</Text>;
  }

  if (hasActiveSelection) {
    const start = Math.min(selectionAnchor as number, cursor);
    const end = Math.max(selectionAnchor as number, cursor);
    const before = display.slice(0, start);
    const cursorAtStart = cursor === start;
    if (cursorAtStart) {
      const cursorChar = start < display.length ? display[start] : " ";
      const rest = display.slice(start + 1, end);
      const after = display.slice(end);
      return (
        <Text>
          {before}
          <Text inverse>{cursorChar}</Text>
          <Text backgroundColor={colors.accentDim}>{rest}</Text>
          {after}
        </Text>
      );
    }
    const selected = display.slice(start, end);
    const cursorChar = end < display.length ? display[end] : " ";
    const after = display.slice(end + 1);
    return (
      <Text>
        {before}
        <Text backgroundColor={colors.accentDim}>{selected}</Text>
        <Text inverse>{cursorChar}</Text>
        {after}
      </Text>
    );
  }

  const before = display.slice(0, cursor);
  const atChar = cursor < display.length ? display[cursor] : " ";
  const after = display.slice(cursor + 1);
  return (
    <Text>
      {before}
      <Text inverse>{atChar}</Text>
      {after}
    </Text>
  );
}
