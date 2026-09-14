import { z } from "zod";
import { makeChatModel } from "../../llm/factory.js";
import type { RagState } from "../state.js";

const GradesSchema = z.object({
  grades: z.array(z.object({
    docId: z.string(),
    relevant: z.boolean(),
    reason: z.string(),
  })),
});

/** LLM 逐条相关性评分（设计文档 6.3） */
export async function gradeNode(state: RagState): Promise<Partial<RagState>> {
  if (state.candidates.length === 0) {
    return {
      relevantDocs: [],
      rewriteFeedback: "上轮检索无候选结果",
      graphSteps: [{ node: "grade", data: { relevant: 0, irrelevant: 0, feedback: "检索无候选" } }],
    };
  }
  const model = makeChatModel().withStructuredOutput(GradesSchema);
  const { grades } = await model.invoke([
    { role: "system", content: "逐条判断资料与问题的相关性。只依据内容是否有助于回答问题判断。输出每条的 docId、relevant、reason（中文，一句话）。" },
    {
      role: "user",
      content: `问题：${state.question}\n\n` +
        state.candidates.map((d, i) => `【${i + 1}】docId=${d.chunkId}\n${d.content.slice(0, 300)}`).join("\n\n"),
    },
  ]);
  const gradeMap = new Map(grades.map((g) => [g.docId, g]));
  const relevantDocs = state.candidates.filter((d) => gradeMap.get(d.chunkId)?.relevant);
  const feedback = relevantDocs.length === 0
    ? `上轮检索到 ${state.candidates.length} 条候选均不相关，原因：${grades.filter((g) => !g.relevant).map((g) => g.reason).slice(0, 3).join("；")}。请换角度改写查询。`
    : "";
  return {
    relevantDocs,
    rewriteFeedback: feedback,
    graphSteps: [{
      node: "grade",
      data: {
        relevant: relevantDocs.length,
        irrelevant: state.candidates.length - relevantDocs.length,
        feedback,
      },
    }],
  };
}

/** 分流谓词（设计文档 6.3.1） */
export function routeByGradeResult(state: RagState): "generate" | "rewrite" | "fallback" {
  if (state.relevantDocs.length >= 1) return "generate";
  if (state.retrievalCount < 2) return "rewrite";
  return "fallback";
}
