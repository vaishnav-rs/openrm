import React, { useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import { colors } from "./theme.js";

interface TextAreaProps {
  value: string;
  onChange: (value: string) => void;
  active: boolean;
  height?: number;
  /** When true, renders without its own border/padding -- for embedding inside a custom frame (e.g. EditorPane). */
  bare?: boolean;
  /**
   * Controlled scroll window (first visible line index). When omitted,
   * TextArea tracks its own scroll position internally (used by standalone
   * callers like onboarding.tsx). EditorPane passes this in so its
   * line-number gutter and TextArea's text rows are guaranteed to share the
   * exact same window -- see the comment on EditorPane's `scrollTop` state
   * for why that single-sourcing matters.
   */
  scrollTop?: number;
  /**
   * Fired whenever the cursor's line index (or the document's total line
   * count) changes, so a parent that owns scroll state (EditorPane) can
   * recompute it using the identical algorithm TextArea uses internally
   * (`computeScrollTop`).
   */
  onCursorLineChange?: (cursorLine: number, totalLines: number) => void;
}

/** Flat offsets (into `value`) where each line begins. Always has length === number of lines. */
export function getLineStarts(value: string): number[] {
  const starts = [0];
  for (let i = 0; i < value.length; i++) {
    if (value[i] === "\n") starts.push(i + 1);
  }
  return starts;
}

/** Index of the line containing flat offset `cursor`, given `lineStarts` from `getLineStarts`. */
export function findLine(lineStarts: number[], cursor: number): number {
  let line = 0;
  for (let i = 0; i < lineStarts.length; i++) {
    if (lineStarts[i] <= cursor) line = i;
    else break;
  }
  return line;
}

/**
 * Minimal-scroll windowing: only nudges `prevScrollTop` up or down as far
 * as needed to bring `cursorLine` back into the visible `height`-row
 * window, rather than recentering on every keystroke. Shared by TextArea's
 * own internal fallback and by EditorPane, so both ever compute the exact
 * same window for the exact same (cursorLine, height, totalLines).
 */
export function computeScrollTop(prevScrollTop: number, cursorLine: number, height: number, totalLines: number): number {
  let scrollTop = prevScrollTop;
  if (cursorLine < scrollTop) {
    scrollTop = cursorLine;
  } else if (cursorLine > scrollTop + height - 1) {
    scrollTop = cursorLine - height + 1;
  }
  const maxScrollTop = Math.max(0, totalLines - height);
  return Math.min(Math.max(scrollTop, 0), maxScrollTop);
}

/** Move `cursor` up/down by `delta` lines, clamped to the target line's own length (not the source column). */
function moveCursorVertical(value: string, cursor: number, delta: number): number {
  const lines = value.split("\n");
  const lineStarts = getLineStarts(value);
  const line = findLine(lineStarts, cursor);
  const col = cursor - lineStarts[line];
  const targetLine = Math.min(Math.max(line + delta, 0), lines.length - 1);
  const targetCol = Math.min(col, lines[targetLine].length);
  return lineStarts[targetLine] + targetCol;
}

type Segment = { text: string; inverse?: boolean; selected?: boolean };

/**
 * Builds the render segments for one visible line: plain text normally,
 * or a small run of [plain, highlighted-selection, inverse-cursor, plain]
 * segments when the cursor and/or an active selection falls on this line.
 */
function buildLineSegments(
  lineText: string,
  isCursorLine: boolean,
  cursorCol: number,
  hasSelectionOnLine: boolean,
  selStart: number,
  selEnd: number
): Segment[] {
  const lineLen = lineText.length;

  if (!hasSelectionOnLine) {
    if (!isCursorLine) return [{ text: lineText }];
    const before = lineText.slice(0, cursorCol);
    const atChar = cursorCol < lineLen ? lineText[cursorCol] : " ";
    const after = lineText.slice(cursorCol + 1);
    const segs: Segment[] = [];
    if (before) segs.push({ text: before });
    segs.push({ text: atChar, inverse: true });
    if (after) segs.push({ text: after });
    return segs;
  }

  // Selection intersects this line. The cursor, if on this line, always sits
  // at exactly one edge of the selection (selStart or selEnd) by definition.
  const segs: Segment[] = [];
  const before = lineText.slice(0, selStart);
  if (before) segs.push({ text: before });

  if (isCursorLine && cursorCol === selStart) {
    const cursorChar = selStart < lineLen ? lineText[selStart] : " ";
    segs.push({ text: cursorChar, inverse: true });
    const restStart = selStart < lineLen ? selStart + 1 : selStart;
    const rest = lineText.slice(restStart, selEnd);
    if (rest) segs.push({ text: rest, selected: true });
    const after = lineText.slice(selEnd);
    if (after) segs.push({ text: after });
  } else {
    const mid = lineText.slice(selStart, selEnd);
    if (mid) segs.push({ text: mid, selected: true });
    if (isCursorLine && cursorCol === selEnd) {
      const cursorChar = selEnd < lineLen ? lineText[selEnd] : " ";
      segs.push({ text: cursorChar, inverse: true });
      const afterStart = selEnd < lineLen ? selEnd + 1 : selEnd;
      const after = lineText.slice(afterStart);
      if (after) segs.push({ text: after });
    } else {
      const after = lineText.slice(selEnd);
      if (after) segs.push({ text: after });
    }
  }

  return segs.length > 0 ? segs : [{ text: " " }];
}

/**
 * Cursor-aware multi-line text editor built directly on Ink's useInput.
 * Tracks a single flat `cursor: number` index into `value` (never a
 * separate line/column pair -- those are derived on demand) plus an
 * optional `selectionAnchor: number | null` for Shift+Arrow selection.
 *
 * Key bindings confirmed against this repo's installed Ink
 * (`node_modules/ink/build/hooks/use-input.js` and `parse-keypress.js`):
 *  - leftArrow/rightArrow/upArrow/downArrow: real key.* booleans, always
 *    available.
 *  - Ctrl+A / Ctrl+E (start/end of line): reliable. Ctrl+letter always
 *    parses to key.ctrl=true with `input` set to the bare letter.
 *  - Ctrl+Home/Ctrl+End or plain Home/End: NOT implemented. Ink's
 *    `useInput` key object has no `home`/`end` field at all (see the field
 *    list built in use-input.js) -- parse-keypress.js internally names
 *    them, but useInput never surfaces that name as a boolean, and for a
 *    plain (non-ctrl) Home/End press `input` is forced to `''` too (they're
 *    in `nonAlphanumericKeys`). There is no reliable public signal to hook
 *    into, so per this task's guidance this is skipped rather than guessed
 *    at via raw escape sequences.
 *  - Shift+Arrow selection: genuinely terminal-dependent. Ink only sees
 *    key.shift=true for an arrow if the terminal sends the xterm extended
 *    modifier form (e.g. CSI 1;2A) which parse-keypress.js's fnKeyRe decodes
 *    into a modifier bitmask (shift = bit 1). Most modern emulators
 *    (xterm, iTerm2, Windows Terminal, VS Code's terminal) do this, but
 *    older/legacy terminals may not, in which case Shift+Arrow arrives
 *    indistinguishable from plain Arrow and selection simply won't extend.
 *    This is a soft degradation (arrow still moves the cursor), not a
 *    crash.
 *  - Backspace vs Delete: NOT reliably distinguishable. parse-keypress.js
 *    maps literal DEL (0x7f) to key.delete=true, and the dedicated forward
 *    Delete key's escape sequence (CSI 3~) *also* maps to key.delete=true
 *    (see `keyName['[3~'] = 'delete'`) -- and 0x7f is what most terminals'
 *    physical Backspace key actually transmits (key.backspace only fires
 *    for the rarer literal 0x08 / Ctrl+H style byte). So on most terminals
 *    pressing Backspace produces key.delete, not key.backspace. Given that
 *    ambiguity, both key.backspace and key.delete are treated as "delete
 *    the character before the cursor" here (matching the original code's
 *    behavior) rather than risking forward-delete misfiring as the far more
 *    common backspace action.
 */
export function TextArea({
  value,
  onChange,
  active,
  height = 15,
  bare = false,
  scrollTop: scrollTopProp,
  onCursorLineChange,
}: TextAreaProps): React.ReactElement {
  const [cursor, setCursor] = useState(value.length);
  const [selectionAnchor, setSelectionAnchor] = useState<number | null>(null);
  const [internalScrollTop, setInternalScrollTop] = useState(0);

  // Keep cursor in range if `value` changes out from under us (e.g. async load).
  useEffect(() => {
    setCursor((c) => Math.min(c, value.length));
  }, [value.length]);

  const lineStarts = getLineStarts(value);
  const cursorLine = findLine(lineStarts, cursor);

  useEffect(() => {
    onCursorLineChange?.(cursorLine, lineStarts.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursorLine, lineStarts.length]);

  useEffect(() => {
    if (scrollTopProp === undefined) {
      setInternalScrollTop((prev) => computeScrollTop(prev, cursorLine, height, lineStarts.length));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursorLine, lineStarts.length, height, scrollTopProp]);

  const scrollTop = scrollTopProp !== undefined ? scrollTopProp : internalScrollTop;

  useInput(
    (input, key) => {
      if (!active) return;
      if (key.ctrl && (input === "s" || input === "S")) return; // let parent handle save

      const hasSelection = selectionAnchor !== null && selectionAnchor !== cursor;

      function deleteSelection(): { newValue: string; newCursor: number } {
        const start = Math.min(selectionAnchor as number, cursor);
        const end = Math.max(selectionAnchor as number, cursor);
        return { newValue: value.slice(0, start) + value.slice(end), newCursor: start };
      }

      if (key.shift && (key.leftArrow || key.rightArrow || key.upArrow || key.downArrow)) {
        const anchor = selectionAnchor === null ? cursor : selectionAnchor;
        let newCursor = cursor;
        if (key.leftArrow) newCursor = Math.max(0, cursor - 1);
        else if (key.rightArrow) newCursor = Math.min(value.length, cursor + 1);
        else if (key.upArrow) newCursor = moveCursorVertical(value, cursor, -1);
        else if (key.downArrow) newCursor = moveCursorVertical(value, cursor, 1);
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
      if (key.upArrow) {
        setSelectionAnchor(null);
        setCursor(moveCursorVertical(value, cursor, -1));
        return;
      }
      if (key.downArrow) {
        setSelectionAnchor(null);
        setCursor(moveCursorVertical(value, cursor, 1));
        return;
      }

      if (key.ctrl && (input === "a" || input === "A")) {
        setSelectionAnchor(null);
        const line = findLine(lineStarts, cursor);
        setCursor(lineStarts[line]);
        return;
      }
      if (key.ctrl && (input === "e" || input === "E")) {
        setSelectionAnchor(null);
        const lines = value.split("\n");
        const line = findLine(lineStarts, cursor);
        setCursor(lineStarts[line] + lines[line].length);
        return;
      }

      if (key.return) {
        if (hasSelection) {
          const { newValue, newCursor } = deleteSelection();
          onChange(newValue.slice(0, newCursor) + "\n" + newValue.slice(newCursor));
          setCursor(newCursor + 1);
          setSelectionAnchor(null);
        } else {
          onChange(value.slice(0, cursor) + "\n" + value.slice(cursor));
          setCursor(cursor + 1);
        }
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

  const lines = value.split("\n");
  const hasActiveSelection = selectionAnchor !== null && selectionAnchor !== cursor;
  const selStartFlat = hasActiveSelection ? Math.min(selectionAnchor as number, cursor) : -1;
  const selEndFlat = hasActiveSelection ? Math.max(selectionAnchor as number, cursor) : -1;

  const visibleStart = Math.min(scrollTop, Math.max(0, lines.length - 1));
  const visibleEnd = Math.min(lines.length, visibleStart + height);
  const visibleLines = lines.slice(visibleStart, visibleEnd);

  const rows = visibleLines.map((lineText, i) => {
    const absoluteIndex = visibleStart + i;
    const lineStart = lineStarts[absoluteIndex];
    const lineLen = lineText.length;
    const isCursorLine = absoluteIndex === cursorLine;
    const cursorCol = isCursorLine ? cursor - lineStart : -1;

    let hasSelectionOnLine = false;
    let selLineStart = 0;
    let selLineEnd = 0;
    if (hasActiveSelection) {
      selLineStart = Math.min(Math.max(selStartFlat - lineStart, 0), lineLen);
      selLineEnd = Math.min(Math.max(selEndFlat - lineStart, 0), lineLen);
      hasSelectionOnLine = selLineEnd > selLineStart;
    }

    if (!isCursorLine && !hasSelectionOnLine) {
      return (
        <Text key={absoluteIndex} wrap="truncate-end">
          {lineText || " "}
        </Text>
      );
    }

    const segments = buildLineSegments(lineText, isCursorLine, cursorCol, hasSelectionOnLine, selLineStart, selLineEnd);

    return (
      <Text key={absoluteIndex} wrap="truncate-end">
        {segments.map((seg, si) =>
          seg.inverse ? (
            <Text key={si} inverse>
              {seg.text}
            </Text>
          ) : seg.selected ? (
            <Text key={si} backgroundColor={colors.accentDim}>
              {seg.text}
            </Text>
          ) : (
            seg.text
          )
        )}
      </Text>
    );
  });

  if (bare) {
    return (
      <Box flexDirection="column" height={height} overflow="hidden">
        {rows}
      </Box>
    );
  }

  return (
    <Box flexDirection="column" borderStyle="single" paddingX={1} height={height + 2} overflow="hidden">
      {rows}
    </Box>
  );
}
