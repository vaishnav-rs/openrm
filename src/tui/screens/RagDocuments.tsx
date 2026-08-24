import React, { useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import { deleteDocument, ingestFile, listDocuments } from "../../rag/ingest.js";
import { TextInput } from "../TextInput.js";
import { colors, icons, padCol, shellGeometry } from "../theme.js";
import { scaledInterval } from "../terminal-env.js";
import { labelRegion, listRowRegions, useClickRegions, type ClickRegion } from "../clickRegions.js";

const RAG_POLL_MS = 4000;

interface DocRow {
  id: string;
  filename: string;
  sourcePath: string;
  chunkCount: number;
}

const COL = { filename: 26, chunks: 10 };

export function RagDocuments({
  active,
  onActivate,
}: {
  active: boolean;
  onActivate?: () => void;
}): React.ReactElement {
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [selected, setSelected] = useState(0);
  const [mode, setMode] = useState<"list" | "input" | "confirm-delete">("list");
  const [path, setPath] = useState("");
  const [status, setStatus] = useState<string | undefined>(undefined);
  const [ingesting, setIngesting] = useState(false);

  async function refresh() {
    const rows = await listDocuments();
    setDocs(rows);
    setSelected((i) => Math.min(i, Math.max(0, rows.length - 1)));
  }

  useEffect(() => {
    void refresh();
  }, []);

  // Live-refresh so document/chunk counts update if ingestion happens from
  // another path while this screen is open.
  useEffect(() => {
    const interval = setInterval(() => void refresh(), scaledInterval(RAG_POLL_MS));
    return () => clearInterval(interval);
  }, []);

  useInput(
    (input, key) => {
      if (!active) return;
      if (mode === "input") {
        if (key.escape) {
          setMode("list");
          return;
        }
        return; // TextInput handles typing + Enter (onSubmit)
      }
      if (mode === "confirm-delete") {
        if (input === "y") confirmDelete();
        else cancelDelete();
        return;
      }
      if (key.upArrow) setSelected((i) => Math.max(0, i - 1));
      else if (key.downArrow) setSelected((i) => Math.min(docs.length - 1, i + 1));
      else if (input === "i") startIngest();
      else if (input === "d") requestDelete();
    },
    { isActive: active }
  );

  // Shared handlers -- called identically from the keyboard above and from
  // click regions below, one code path per action.
  function startIngest() {
    setPath("");
    setMode("input");
  }
  function requestDelete() {
    if (docs[selected]) setMode("confirm-delete");
  }
  function confirmDelete() {
    if (!docs[selected]) return;
    void (async () => {
      await deleteDocument(docs[selected].id);
      setSelected(0);
      setMode("list");
      await refresh();
    })();
  }
  function cancelDelete() {
    setMode("list");
  }

  // Click regions --------------------------------------------------------
  //
  // Row math mirrors the JSX below: title, a marginTop blank row, the
  // column-header row, then one row per document. Everything after that is
  // a variable stack of conditionally-rendered marginTop=1 blocks (input
  // box, confirm-delete line, ingesting/status line), tracked with a
  // running `row` cursor rather than a fixed formula since which blocks
  // are present changes with `mode`/`ingesting`/`status`.
  const listStartRow = shellGeometry.screenTopRow + 3;
  let row = listStartRow + docs.length;
  let confirmContentRow: number | undefined;
  if (mode === "confirm-delete" && docs[selected]) {
    confirmContentRow = row + 1;
    row += 2;
  } else if (mode === "input") {
    row += 4; // blank marginTop + border top + content + border bottom
  }
  if (ingesting || (status && !ingesting)) {
    row += 2;
  }
  const footerRow = row + 1;

  const clickRegions: ClickRegion[] = [];
  if (mode === "list") {
    clickRegions.push(
      ...listRowRegions(listStartRow, shellGeometry.screenLeftCol, docs.length, (i) => {
        setSelected(i);
        onActivate?.();
      })
    );
    const footerLine = "[i] Ingest New File · [d] Delete Selected";
    const ingest = labelRegion(footerLine, footerRow, shellGeometry.screenLeftCol, "[i] Ingest New File", () => {
      onActivate?.();
      startIngest();
    });
    const del = labelRegion(footerLine, footerRow, shellGeometry.screenLeftCol, "[d] Delete Selected", () => {
      onActivate?.();
      requestDelete();
    });
    if (ingest) clickRegions.push(ingest);
    if (del) clickRegions.push(del);
  } else if (mode === "confirm-delete" && confirmContentRow !== undefined) {
    const confirmLine = "[y] Confirm  [esc] Cancel";
    const yes = labelRegion(confirmLine, confirmContentRow, shellGeometry.screenLeftCol, "[y] Confirm", () => {
      onActivate?.();
      confirmDelete();
    });
    const no = labelRegion(confirmLine, confirmContentRow, shellGeometry.screenLeftCol, "[esc] Cancel", () => {
      onActivate?.();
      cancelDelete();
    });
    if (yes) clickRegions.push(yes);
    if (no) clickRegions.push(no);
  }
  useClickRegions(clickRegions, active);

  async function handleSubmitPath(value: string) {
    if (!value.trim()) {
      setMode("list");
      return;
    }
    setIngesting(true);
    setStatus(undefined);
    try {
      const result = await ingestFile(value.trim());
      setStatus(`Ingested ${result.filename}: ${result.chunkCount} chunks`);
      await refresh();
    } catch (err) {
      setStatus(`Failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIngesting(false);
      setMode("list");
    }
  }

  return (
    <Box flexDirection="column">
      <Text bold color={colors.text}>
        {icons.book} RAG Documents
      </Text>
      <Box marginTop={1} flexDirection="column">
        <Text color={colors.mutedDim}>
          {padCol("FILENAME", COL.filename)} {padCol("CHUNKS", COL.chunks)} SOURCE
        </Text>
        {docs.length === 0 && <Text dimColor>No documents ingested yet.</Text>}
        {docs.map((d, i) => {
          const isSel = active && mode === "list" && i === selected;
          return (
            <Text key={d.id} color={isSel ? colors.accent : colors.text} bold={isSel}>
              {isSel ? icons.arrowRight : " "} {padCol(d.filename, COL.filename)} {padCol(String(d.chunkCount), COL.chunks)}{" "}
              <Text color={colors.mutedDim}>{d.sourcePath}</Text>
            </Text>
          );
        })}
      </Box>
      {mode === "input" && (
        <Box marginTop={1} borderStyle="round" borderColor={colors.borderFocus} paddingX={1}>
          <Text>Path to .txt/.md/.pdf file: </Text>
          <TextInput
            value={path}
            onChange={setPath}
            onSubmit={handleSubmitPath}
            active={active && mode === "input"}
            placeholder="/path/to/file.pdf"
          />
        </Box>
      )}
      {mode === "confirm-delete" && docs[selected] && (
        <Box marginTop={1}>
          <Text color={colors.warning}>
            Delete "{docs[selected].filename}"?{" "}
            <Text color={colors.success}>[y] Confirm</Text>
            {"  "}
            <Text color={colors.textDim}>[esc] Cancel</Text>
          </Text>
        </Box>
      )}
      {ingesting && (
        <Box marginTop={1}>
          <Text color={colors.warning}>{icons.spinner[0]} Ingesting (embedding chunks)...</Text>
        </Box>
      )}
      {status && !ingesting && (
        <Box marginTop={1}>
          <Text color={status.startsWith("Failed") ? colors.error : colors.success}>
            {status.startsWith("Failed") ? icons.cross : icons.check} {status}
          </Text>
        </Box>
      )}
      <Box marginTop={1}>
        <Text dimColor>
          <Text color={colors.accent}>[i] Ingest New File</Text> ·{" "}
          <Text color={colors.accent}>[d] Delete Selected</Text>
        </Text>
      </Box>
    </Box>
  );
}
