import React, { useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import { deleteDocument, ingestFile, listDocuments } from "../../rag/ingest.js";
import { TextInput } from "../TextInput.js";

interface DocRow {
  id: string;
  filename: string;
  sourcePath: string;
  chunkCount: number;
}

export function RagDocuments({ active }: { active: boolean }): React.ReactElement {
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [selected, setSelected] = useState(0);
  const [mode, setMode] = useState<"list" | "input">("list");
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
      if (key.upArrow) setSelected((i) => Math.max(0, i - 1));
      else if (key.downArrow) setSelected((i) => Math.min(docs.length - 1, i + 1));
      else if (input === "i") {
        setPath("");
        setMode("input");
      } else if (input === "d" && docs[selected]) {
        void (async () => {
          await deleteDocument(docs[selected].id);
          setSelected(0);
          await refresh();
        })();
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
      <Text bold>RAG Documents</Text>
      <Box marginTop={1} flexDirection="column">
        {docs.length === 0 && <Text dimColor>No documents ingested yet.</Text>}
        {docs.map((d, i) => (
          <Text key={d.id} color={active && mode === "list" && i === selected ? "green" : undefined}>
            {active && mode === "list" && i === selected ? "> " : "  "}
            {d.filename} ({d.chunkCount} chunks) -- {d.sourcePath}
          </Text>
        ))}
      </Box>
      {mode === "input" && (
        <Box marginTop={1}>
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
      {ingesting && <Text dimColor>Ingesting (embedding chunks)...</Text>}
      {status && <Text>{status}</Text>}
      <Box marginTop={1}>
        <Text dimColor>i ingest new file, d delete selected</Text>
      </Box>
    </Box>
  );
}
