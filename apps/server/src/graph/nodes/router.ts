import { z } from "zod";
import { makeChatModel } from "../../llm/factory.js";
import type { RagState } from "../state.js";

const RouteSchema = z.object({ route: z.enum(["chat", "rag"]) });

/** 意图二分类：闲聊走短路径（设计文档 6.3） */
export async function routerNode(state: RagState): Promise<Partial<RagState>> {
  const model = makeChatModel().withStructuredOutput(RouteSchema);
  const { route } = await model.invoke([
    { role: "system", content: "你是意图分类器。用户输入是想闲聊（问候/寒暄/身份询问）返回 chat；需要查询知识库（产品、政策、流程等事实问题）返回 rag。" },
    { role: "user", content: state.question },
  ]);
  return {
    route,
    graphSteps: [{ node: "router", summary: route === "chat" ? "意图：闲聊" : "意图：知识问题" }],
  };
}

export function routeByIntent(state: RagState): "chat" | "rag" {
  return state.route;
}
