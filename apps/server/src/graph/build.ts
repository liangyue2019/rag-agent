import { StateGraph, START, END } from "@langchain/langgraph";
import { RagState } from "./state.js";
import { routerNode, routeByIntent } from "./nodes/router.js";
import { rewriteNode } from "./nodes/rewrite.js";
import { retrieveNode } from "./nodes/retrieve.js";
import { gradeNode, routeByGradeResult } from "./nodes/grade.js";
import { generateNode } from "./nodes/generate.js";
import { chatReplyNode } from "./nodes/chat-reply.js";
import { fallbackNode } from "./nodes/fallback.js";

/** 组装 RAG 图（设计文档 6.3）：
 * router → (chat→chatReply | rag→rewrite→retrieve→grade → generate/rewrite 重试/fallback) */
export function buildRagGraph() {
  return new StateGraph(RagState)
    .addNode("router", routerNode)
    .addNode("rewrite", rewriteNode)
    .addNode("retrieve", retrieveNode)
    .addNode("grade", gradeNode)
    .addNode("generate", generateNode)
    .addNode("chatReply", chatReplyNode)
    .addNode("fallback", fallbackNode)
    .addEdge(START, "router")
    .addConditionalEdges("router", routeByIntent, { chat: "chatReply", rag: "rewrite" })
    .addEdge("rewrite", "retrieve")
    .addEdge("retrieve", "grade")
    .addConditionalEdges("grade", routeByGradeResult, {
      generate: "generate", rewrite: "rewrite", fallback: "fallback",
    })
    .addEdge("generate", END)
    .addEdge("chatReply", END)
    .addEdge("fallback", END)
    .compile();
}
