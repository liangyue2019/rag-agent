import { z } from "zod";
import { makeRerankModel } from "../llm/factory.js";
import type { RetrievedDoc } from "@rag/shared";

export const RERANK_MIN_SCORE = 3;

const ScoresSchema = z.object({
  scores: z.array(z.object({
    docId: z.string(),
    score: z.number().min(0).max(10),
  })),
});

/** DeepSeek LLM 重排序：打分 0-10 → 降序重排 → 剪除低分。未返回的 docId 按 0 分处理。 */
export async function rerankDocs(query: string, docs: RetrievedDoc[]): Promise<RetrievedDoc[]> {
  if (docs.length === 0) return [];
  const model = makeRerankModel().withStructuredOutput(ScoresSchema);
  const { scores } = await model.invoke([
    { role: "system", content: "你是检索结果重排序器。给定用户问题和候选资料列表，为每条资料输出 0-10 的相关性分数（10=直接回答问题；5=部分相关；0=完全无关）。只依据资料内容与问题的语义相关性评分，输出每条的 docId 与 score。" },
    {
      role: "user",
      content: `问题：${query}\n\n` +
        docs.map((d, i) => `【${i + 1}】docId=${d.chunkId}\n${d.content.slice(0, 300)}`).join("\n\n"),
    },
  ]);
  const scoreMap = new Map(scores.map((s) => [s.docId, s.score]));
  return docs
    .map((d, i) => ({ d, score: scoreMap.get(d.chunkId) ?? 0, i }))
    .filter((x) => x.score >= RERANK_MIN_SCORE)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map((x) => x.d);
}
