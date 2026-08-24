import { getPrisma } from "../../db/prisma.js";
import { getActiveProvider } from "../../providers/registry.js";
import type { AgentTool } from "../tool-types.js";

interface ChunkMatchRow {
  id: string;
  content: string;
  documentId: string;
  filename: string;
  distance: number;
}

const retrieveKnowledge: AgentTool = {
  definition: {
    name: "retrieve_knowledge",
    description:
      "Search the business's ingested knowledge base (uploaded docs) for passages " +
      "relevant to a query. Use this when the customer asks something specific about " +
      "products, services, pricing, or policies that you're not certain about.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "What to search for." },
        k: {
          type: "number",
          description: "How many passages to return (default 5, max 20).",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  async execute(args) {
    const query = typeof args.query === "string" ? args.query.trim() : "";
    if (!query) return "retrieve_knowledge requires a non-empty 'query'.";
    const k = Math.min(Math.max(typeof args.k === "number" ? args.k : 5, 1), 20);

    const provider = await getActiveProvider();
    const embedding = await provider.embed(query);
    const vectorLiteral = `[${embedding.join(",")}]`;

    const prisma = getPrisma();
    const rows = await prisma.$queryRawUnsafe<ChunkMatchRow[]>(
      `
      SELECT c.id, c.content, c."documentId", d.filename,
             (c.embedding <=> $1::vector) AS distance
      FROM "Chunk" c
      JOIN "Document" d ON d.id = c."documentId"
      WHERE c.embedding IS NOT NULL
      ORDER BY c.embedding <=> $1::vector
      LIMIT $2
      `,
      vectorLiteral,
      k
    );

    if (rows.length === 0) {
      return "No matching knowledge base passages found.";
    }

    return JSON.stringify(
      rows.map((r) => ({
        source: r.filename,
        content: r.content,
        relevance: 1 - r.distance,
      }))
    );
  },
};

export const ragTools: AgentTool[] = [retrieveKnowledge];
