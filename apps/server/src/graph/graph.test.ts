import { describe, expect, it, vi } from "vitest";

// 各节点每次调用 makeChatModel() 都得到新实例，闭包计数器无法跨实例共享：
// 改为共享 vi.hoisted 状态 + 依 system prompt 分发（router/rewrite/grade 三类结构化调用）
const mockState = vi.hoisted(() => ({
  route: "rag" as "chat" | "rag",
  allIrrelevant: false,
}));

vi.mock("../llm/factory.js", () => ({
  makeChatModel: () => ({
    withStructuredOutput: () => ({
      invoke: async (msgs: { role: string; content: string }[]) => {
        const system = msgs[0].content;
        if (system.includes("意图分类器")) return { route: mockState.route };
        if (system.includes("改写")) return { queries: ["退货政策 变体"] };
        // grade：从 user 消息解析 docId 逐条打分
        const docIds = [...msgs[1].content.matchAll(/docId=(\S+)/g)].map((m) => m[1]);
        return {
          grades: docIds.map((docId) => ({
            docId,
            relevant: !mockState.allIrrelevant,
            reason: mockState.allIrrelevant ? "主题无关" : "直接回答问题",
          })),
        };
      },
    }),
    stream: async () => (async function* () {
      yield { content: "答案片段一" };
      yield { content: "答案片段二 [1]" };
    })(),
  }),
}));

vi.mock("../retrieval/hybrid.js", () => ({
  hybridSearch: vi.fn().mockResolvedValue([
    { chunkId: "c1", documentId: "d1", docTitle: "文档A", sourceType: "file", sourceRef: "a.pdf", content: "内容甲", score: 1 },
  ]),
}));

import { buildRagGraph } from "./build.js";
import { HumanMessage } from "@langchain/core/messages";

async function invokeGraph(question: string) {
  const graph = buildRagGraph();
  return graph.invoke({
    messages: [new HumanMessage(question)],
    question,
  });
}

const stepNodes = (steps: unknown) =>
  (steps as Array<{ node: string }>).map((s) => s.node);

describe("RAG 图集成（mock LLM）", () => {
  it("rag 路径：router→rewrite→retrieve→grade→generate，产出 answer+citations+graphSteps", async () => {
    mockState.route = "rag";
    mockState.allIrrelevant = false;

    const result = await invokeGraph("退货政策是什么");

    expect(result.route).toBe("rag");
    expect(result.answer).toBe("答案片段一答案片段二 [1]");
    expect(result.relevantDocs.map((d) => d.chunkId)).toEqual(["c1"]);
    expect(result.retrievalCount).toBe(1);
    expect(result.citations).toEqual([
      expect.objectContaining({ n: 1, chunkId: "c1", docTitle: "文档A" }),
    ]);
    expect(stepNodes(result.graphSteps))
      .toEqual(["router", "rewrite", "retrieve", "grade", "generate"]);
  }, 30_000);

  it("chat 路径：router→chatReply 短路，不检索", async () => {
    mockState.route = "chat";

    const result = await invokeGraph("你好");

    expect(result.route).toBe("chat");
    expect(result.answer).toContain("答案片段一");
    expect(result.candidates).toHaveLength(0);
    expect(result.citations).toEqual([]);
    expect(stepNodes(result.graphSteps)).toEqual(["router", "chatReply"]);
  }, 30_000);

  it("两轮检索全不相关 → fallback 诚实拒答", async () => {
    mockState.route = "rag";
    mockState.allIrrelevant = true;

    const result = await invokeGraph("量子力学是什么");

    expect(result.retrievalCount).toBe(2);
    expect(result.answer).toContain("抱歉");
    expect(result.citations).toEqual([]);
    expect(stepNodes(result.graphSteps))
      .toEqual(["router", "rewrite", "retrieve", "grade", "rewrite", "retrieve", "grade", "fallback"]);
  }, 30_000);
});
