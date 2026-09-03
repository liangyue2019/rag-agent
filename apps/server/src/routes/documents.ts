import { Router } from "express";
import multer from "multer";
import { v4 as uuid } from "uuid";
import { desc, eq, asc } from "drizzle-orm";
import { db } from "../db/client.js";
import { chunks, documents } from "../db/schema.js";
import { enqueueIngest, deleteDocumentFully } from "../ingest/pipeline.js";
import { ALLOWED_MIME, MAX_FILE_BYTES } from "../ingest/parsers.js";
import { FaqInput, UrlImportRequest } from "@rag/shared";

export const documentsRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE_BYTES } });

const toDto = (d: typeof documents.$inferSelect) => ({
  id: d.id, title: d.title, sourceType: d.sourceType as "file" | "url" | "faq",
  sourceRef: d.sourceRef, status: d.status as "processing" | "ready" | "failed",
  error: d.error, chunkCount: d.chunkCount, createdAt: d.createdAt.toISOString(),
});

/** 文档/FAQ 统一列表 */
documentsRouter.get("/", async (_req, res) => {
  const rows = await db.select().from(documents).orderBy(desc(documents.createdAt));
  res.json(rows.map(toDto));
});

/** 文件上传：202 + documentId */
documentsRouter.post("/upload", upload.single("file"), async (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: "缺少 file 字段" });
  if (!(ALLOWED_MIME as readonly string[]).includes(file.mimetype)) {
    return res.status(400).json({ error: `不支持的文件类型: ${file.mimetype}` });
  }
  const id = uuid();
  await db.insert(documents).values({
    id, title: file.originalname, sourceType: "file",
    sourceRef: file.originalname, mime: file.mimetype, sizeBytes: file.size,
  });
  enqueueIngest({ documentId: id, buffer: file.buffer, mime: file.mimetype, title: file.originalname });
  res.status(202).json({ documentId: id });
});

/** URL 导入 */
documentsRouter.post("/url", async (req, res) => {
  const { url } = UrlImportRequest.parse(req.body);
  const id = uuid();
  const u = new URL(url);
  await db.insert(documents).values({
    id, title: u.hostname + u.pathname, sourceType: "url", sourceRef: url,
  });
  enqueueIngest({ documentId: id, url });
  res.status(202).json({ documentId: id });
});

/** 删除（含向量与 df 回退） */
documentsRouter.delete("/:id", async (req, res) => {
  await deleteDocumentFully(req.params.id);
  res.status(204).end();
});

/** 分块预览 */
documentsRouter.get("/:id/chunks", async (req, res) => {
  const rows = await db.select().from(chunks)
    .where(eq(chunks.documentId, req.params.id)).orderBy(asc(chunks.seq));
  res.json(rows.map((c) => ({
    seq: c.seq, content: c.content, tokenCount: c.tokenCount,
  })));
});

/** FAQ CRUD（复用 documents 表，sourceType=faq） */
documentsRouter.post("/faqs", async (req, res) => {
  const { question, answer } = FaqInput.parse(req.body);
  const id = uuid();
  await db.insert(documents).values({ id, title: question, sourceType: "faq", sourceRef: "" });
  enqueueIngest({ documentId: id, question, answer });
  res.status(202).json({ documentId: id });
});

documentsRouter.get("/faqs", async (_req, res) => {
  const rows = await db.select().from(documents).where(eq(documents.sourceType, "faq"));
  res.json(rows.map(toDto));
});

documentsRouter.put("/faqs/:id", async (req, res) => {
  const { question, answer } = FaqInput.parse(req.body);
  await deleteDocumentFully(req.params.id);
  const id = uuid();
  await db.insert(documents).values({ id, title: question, sourceType: "faq", sourceRef: "" });
  enqueueIngest({ documentId: id, question, answer });
  res.status(202).json({ documentId: id });
});
