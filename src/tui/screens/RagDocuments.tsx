import React, { useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import { deleteDocument, ingestFile, listDocuments } from "../../rag/ingest.js";
import { TextInput } from "../TextInput.js";
import { colors, icons, padCol } from "../theme.js";

interface DocRow {
  id: string;
  filename: string;
  sourcePath: string;
  chunkCount: number;
}

const COL = { filename: 26, chunks: 10 };

export function RagDocuments({ active }: { active: boolean }): React.ReactElement {
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [selected, setSelected] = useState(0);
  const [mode, setMode] = useState<"list" | "input" | "confirm-delete">("list");
  const [path, setPath] = useState("");
  const [status, setStatus] = useState<string | undefined>(undefined);
  const [ingesting, setIngesting] = useState(false);

  async function refresh() {
    const rows = await listDocuments();
    setDocs(rows);
  }

  useEffect(() => {
    void refresh();
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
        if (input === "y" && docs[selected]) {
          void (async () => {
            await deleteDocument(docs[selected].id);
            setSelected(0);
            setMode("list");
            await refresh();
          })();
        } else {
          setMode("list");
        }
        return;
      }
      if (key.upArrow) setSelected((i) => Math.max(0, i - 1));
      else if (key.downArrow) setSelected((i) => Math.min(docs.length - 1, i + 1));
      else if (input === "i") {
        setPath("");
        setMode("input");
      } else if (input === "d" && docs[selected]) {
        setMode("confirm-delete");
      }
    },
    { isActive: active }
  );

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
            Delete "{docs[selected].filename}"? y confirm, any other key to cancel.
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
        <Text dimColor>i ingest new file · d delete selected</Text>
      </Box>
    </Box>
  );
}
