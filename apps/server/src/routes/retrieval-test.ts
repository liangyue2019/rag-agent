import { Router } from "express";
import { hybridSearch } from "../retrieval/hybrid.js";
import { RetrievalTestRequest } from "@rag/shared";

export const retrievalTestRouter = Router();

/** 检索效果测试：query+topK（默认 5）→ RRF 融合 top 命中摘要 */
retrievalTestRouter.post("/", async (req, res) => {
  const { query, topK } = RetrievalTestRequest.parse(req.body);
  const hits = await hybridSearch(query, topK);
  res.json(hits.map((h) => ({
    chunkId: h.chunkId, docTitle: h.docTitle, score: h.score,
    preview: h.content.slice(0, 120),
  })));
});
