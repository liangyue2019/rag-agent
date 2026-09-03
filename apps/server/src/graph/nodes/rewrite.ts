import { z } from "zod";
import { makeChatModel } from "../../llm/factory.js";
import type { RagState } from "../state.js";

const QueriesSchema = z.object({
  queries: z.array(z.string()).min(1).max(2),
});

/** 多查询改写：指代消解 + 变体扩展；重试轮注入上轮反馈 */
export async function rewriteNode(state: RagState): Promise<Partial<RagState>> {
  const history = state.messages.slice(-10)
    .map((m) => `${m.getType()}: ${String(m.content)}`).join("\n");
  const feedback = state.retrievalCount > 0
    ? `\n上轮检索反馈（请针对性改写）：${state.rewriteFeedback}` : "";
  const model = makeChatModel().withStructuredOutput(QueriesSchema);
  const { queries } = await model.invoke([
    { role: "system", content: `根据对话历史改写用户问题用于知识库检索：1) 消解代词指代，补全为独立完整的问题；2) 生成 1~2 个不同角度的同义变体。${feedback}` },
    { role: "user", content: `对话历史：\n${history}\n\n当前问题：${state.question}` },
  ]);
  const all = [state.question, ...queries.filter((q) => q !== state.question)];
  return {
    queries: all,
    retrievalCount: state.retrievalCount + 1,
    graphSteps: [{ node: "rewrite", data: { queries: all, round: state.retrievalCount + 1 } }],
  };
}
