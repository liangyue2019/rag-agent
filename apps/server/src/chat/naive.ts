import type { AIMessageChunk } from "@langchain/core/messages";
import { makeChatModel } from "../llm/factory.js";
import { hybridSearch } from "../retrieval/hybrid.js";
import { buildContext, NAIVE_SYSTEM } from "./citations.js";
import type { RetrievedDoc } from "@rag/shared";

/** 直线式 RAG：检索 → 拼 context → LLM 流式生成（无图） */
export async function naiveAnswer(question: string): Promise<{
  docs: RetrievedDoc[];
  stream: AsyncIterable<AIMessageChunk>;
}> {
  const docs = await hybridSearch(question, 5);
  const model = makeChatModel();
  const stream = await model.stream([
    { role: "system", content: NAIVE_SYSTEM },
    { role: "user", content: `${buildContext(docs)}\n\n问题：${question}` },
  ]);
  return { docs, stream };
}
