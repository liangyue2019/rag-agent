import { qdrant, COLLECTION } from "../qdrant/client.js";
import { makeEmbeddings } from "../llm/factory.js";
import { db } from "../db/client.js";
import { bm25Df } from "../db/schema.js";
import { buildQuerySparse, tokenize } from "../ingest/bm25.js";
import type { RetrievedDoc } from "@rag/shared";

const embeddings = makeEmbeddings();

/** dense+BM25 双路 prefetch，Qdrant 服务端 RRF 融合（设计文档 6.4） */
export async function hybridSearch(query: string, topK = 5): Promise<RetrievedDoc[]> {
  const [dense, dfRows] = await Promise.all([
    embeddings.embedQuery(query),
    db.select().from(bm25Df),
  ]);
  const dfMap = new Map(dfRows.map((r) => [r.word, r.df]));
  const total = await qdrant.count(COLLECTION, { exact: true });
  const totalDocs = total.count;
  const sparse = buildQuerySparse(tokenize(query), dfMap, totalDocs);

  const result = await qdrant.query(COLLECTION, {
    prefetch: [
      { query: dense, using: "dense", limit: 20 },
      { query: sparse, using: "sparse", limit: 20 },
    ],
    query: { fusion: "rrf" },
    limit: topK,
    with_payload: true,
  });

  return result.points.map((p) => {
    const pl = p.payload as Record<string, unknown>;
    return {
      chunkId: String(pl.chunkId),
      documentId: String(pl.documentId),
      docTitle: String(pl.docTitle),
      sourceType: pl.sourceType as RetrievedDoc["sourceType"],
      sourceRef: String(pl.sourceRef),
      content: String(pl.content),
      score: p.score ?? 0,
    };
  });
}
