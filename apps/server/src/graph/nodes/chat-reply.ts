import { makeChatModel } from "../../llm/factory.js";
import type { RagState } from "../state.js";

const SYSTEM = "你是友好的客服助手，进行日常寒暄与身份介绍，不涉及知识库检索。";

export async function chatReplyNode(state: RagState): Promise<Partial<RagState>> {
  const model = makeChatModel();
  const stream = await model.stream([
    { role: "system", content: SYSTEM },
    { role: "user", content: state.question },
  ]);
  let answer = "";
  for await (const c of stream) answer += typeof c.content === "string" ? c.content : "";
  return { answer, graphSteps: [{ node: "chatReply", summary: "闲聊直接回复" }] };
}
