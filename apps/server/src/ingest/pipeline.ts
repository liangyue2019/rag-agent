import PQueue from "p-queue";
import { v4 as uuid } from "uuid";
import { eq, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { bm25Df, chunks, documents } from "../db/schema.js";
import { qdrant, COLLECTION } from "../qdrant/client.js";
import { makeEmbeddings } from "../llm/factory.js";
import { parseFile, parseUrl } from "./parsers.js";
import { chunkText } from "./chunker.js";
import {
  buildChunkSparse, computeDfDelta, rollbackDf, tokenize, type DfDelta,
} from "./bm25.js";
import { logger } from "../logger.js";

const queue = new PQueue({ concurrency: 2 });

export interface IngestFileInput { documentId: string; buffer: Buffer; mime: string; title: string }
export interface IngestUrlInput { documentId: string; url: string }
export interface IngestFaqInput { documentId: string; question: string; answer: string }

/** 统一入口：立即入队，返回时不阻塞 */
export function enqueueIngest(job: IngestFileInput | IngestUrlInput | IngestFaqInput) {
  queue.add(() => runIngest(job).catch((e) => logger.error({ err: e }, "ingest failed")));
}

async function runIngest(job: IngestFileInput | IngestUrlInput | IngestFaqInput) {
  try {
    if ("buffer" in job) await ingestDocument(job.documentId, () => parseFile(job.buffer, job.mime));
    else if ("url" in job) await ingestDocument(job.documentId, () => parseUrl(job.url));
    else await ingestFaq(job.documentId, job.question, job.answer);
  } catch (e) {
    await db.update(documents)
      .set({ status: "failed", error: e instanceof Error ? e.message : String(e), updatedAt: new Date() })
      .where(eq(documents.id, job.documentId));
    logger.error({ documentId: job.documentId, err: e }, "ingest 失败");
  }
}

/** 文档/网页：解析→分块→双路向量化→Qdrant upsert→SQLite 落库 */
async function ingestDocument(documentId: string, extract: () => Promise<string>) {
  const text = await extract();
  const parts = await chunkText(text);
  if (parts.length === 0) throw new Error("解析后无有效内容");
  await writeChunks(documentId, parts.map((p) => p.content));
}

/** FAQ：单条 Q/A 作为最小检索单元（设计文档 5.2/6.3） */
async function ingestFaq(documentId: string, question: string, answer: string) {
  await writeChunks(documentId, [`${question}\n${answer}`], { faqQ: question, faqA: answer });
}

async function writeChunks(
  documentId: string,
  contents: string[],
  faq?: { faqQ: string; faqA: string },
) {
  const doc = (await db.select().from(documents).where(eq(documents.id, documentId)))[0];
  if (!doc) throw new Error(`document ${documentId} 不存在`);

  // 1) dense 向量（批量）
  const embeddings = makeEmbeddings();
  const dense = await embeddings.embedDocuments(contents);

  // 2) sparse 向量 + df 增量
  const tokenLists = contents.map((c) => tokenize(c));
  const sparse = tokenLists.map(buildChunkSparse);
  const delta = computeDfDelta(tokenLists);

  // 3) Qdrant upsert（point id = uuid）
  const points = contents.map((content, i) => ({
    id: uuid(),
    vector: { dense: dense[i], sparse: sparse[i] },
    payload: {
      chunkId: uuid(),
      documentId,
      docTitle: doc.title,
      sourceType: doc.sourceType,
      sourceRef: doc.sourceRef,
      seq: i,
      content,
      ...(faq ?? {}),
    },
  }));
  await qdrant.upsert(COLLECTION, { points, wait: true });

  // 4) SQLite 落库（chunks + df 增量 + 文档状态）
  await db.transaction(async (tx) => {
    await tx.insert(chunks).values(contents.map((content, i) => ({
      id: points[i].payload.chunkId,
      documentId,
      seq: i,
      content,
      tokenCount: content.length,
      qdrantPointId: String(points[i].id),
    })));
    for (const [w, d] of delta) {
      await tx.insert(bm25Df).values({ word: w, df: d })
        .onConflictDoUpdate({ target: bm25Df.word, set: { df: sql`${bm25Df.df} + ${d}` } });
    }
    await tx.update(documents)
      .set({ status: "ready", chunkCount: contents.length, updatedAt: new Date() })
      .where(eq(documents.id, documentId));
  });
}

/** 删除文档：SQLite 级联 + Qdrant 按 filter 删 + df 回退（设计文档 7.3） */
export async function deleteDocumentFully(documentId: string) {
  const docChunks = await db.select().from(chunks).where(eq(chunks.documentId, documentId));
  const dfRows = await db.select().from(bm25Df);
  const df = new Map(dfRows.map((r) => [r.word, r.df]));
  const delta: DfDelta = computeDfDelta(docChunks.map((c) => tokenize(c.content)));
  rollbackDf(df, delta);
  await db.transaction(async (tx) => {
    for (const [w] of delta) {
      const next = df.get(w) ?? 0;
      if (next > 0) await tx.update(bm25Df).set({ df: next }).where(eq(bm25Df.word, w));
      else await tx.delete(bm25Df).where(eq(bm25Df.word, w));
    }
    await tx.delete(documents).where(eq(documents.id, documentId)); // chunks 级联删
  });
  await qdrant.delete(COLLECTION, {
    filter: { must: [{ key: "documentId", match: { value: documentId } }] },
    wait: true,
  });
}
