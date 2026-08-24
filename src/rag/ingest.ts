import { readFileSync } from "node:fs";
import { basename, extname } from "node:path";
import { getPrisma } from "../db/prisma.js";
import { getActiveProvider } from "../providers/registry.js";

const APPROX_CHARS_PER_TOKEN = 4;
const CHUNK_TOKENS = 500;
const CHUNK_OVERLAP_TOKENS = 50;
const CHUNK_CHARS = CHUNK_TOKENS * APPROX_CHARS_PER_TOKEN;
const OVERLAP_CHARS = CHUNK_OVERLAP_TOKENS * APPROX_CHARS_PER_TOKEN;

async function readFileText(path: string): Promise<string> {
  const ext = extname(path).toLowerCase();
  if (ext === ".pdf") {
    // Lazy import: pdf-parse pulls in some heavier deps we don't want to
    // load for the common .txt/.md ingestion path.
    const pdfParse = (await import("pdf-parse")).default;
    const buffer = readFileSync(path);
    const data = await pdfParse(buffer);
    return data.text;
  }
  // .txt / .md / anything else: read directly as UTF-8 text.
  return readFileSync(path, "utf-8");
}

function chunkText(text: string): string[] {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

  const chunks: string[] = [];
  let start = 0;
  while (start < normalized.length) {
    const end = Math.min(start + CHUNK_CHARS, normalized.length);
    chunks.push(normalized.slice(start, end));
    if (end >= normalized.length) break;
    start = end - OVERLAP_CHARS;
    if (start < 0) start = 0;
  }
  return chunks;
}

export interface IngestResult {
  documentId: string;
  filename: string;
  chunkCount: number;
}

/**
 * Reads a local .txt/.md/.pdf file, splits it into ~500-token chunks with
 * slight overlap, embeds each chunk via the active provider, and inserts
 * Document + Chunk rows. Chunk.embedding is written via raw SQL since Prisma
 * cannot set an Unsupported("vector") column through the normal client API.
 */
export async function ingestFile(path: string): Promise<IngestResult> {
  const filename = basename(path);
  const text = await readFileText(path);
  const chunks = chunkText(text);

  const prisma = getPrisma();
  const provider = await getActiveProvider();

  const document = await prisma.document.create({
    data: { filename, sourcePath: path },
  });

  for (let ordinal = 0; ordinal < chunks.length; ordinal++) {
    const content = chunks[ordinal];
    const embedding = await provider.embed(content);
    const vectorLiteral = `[${embedding.join(",")}]`;

    const chunk = await prisma.chunk.create({
      data: {
        documentId: document.id,
        content,
        ordinal,
      },
    });

    await prisma.$executeRawUnsafe(
      `UPDATE "Chunk" SET embedding = $1::vector WHERE id = $2`,
      vectorLiteral,
      chunk.id
    );
  }

  return { documentId: document.id, filename, chunkCount: chunks.length };
}

export async function listDocuments() {
  const prisma = getPrisma();
  const documents = await prisma.document.findMany({
    include: { _count: { select: { chunks: true } } },
    orderBy: { createdAt: "desc" },
  });
  return documents.map((d) => ({
    id: d.id,
    filename: d.filename,
    sourcePath: d.sourcePath,
    createdAt: d.createdAt,
    chunkCount: d._count.chunks,
  }));
}

export async function deleteDocument(documentId: string): Promise<void> {
  const prisma = getPrisma();
  await prisma.document.delete({ where: { id: documentId } });
}
