import { describe, expect, it, vi } from "vitest";

function fakeModel(graded: { docId: string; relevant: boolean; reason: string }[]) {
  return {
    makeChatModel: () => ({
      withStructuredOutput: () => ({ invoke: async () => ({ grades: graded }) }),
    }),
  };
}

const docs = (n: number) => Array.from({ length: n }, (_, i) => ({
  chunkId: `c${i}`, documentId: "d", docTitle: "t", sourceType: "file" as const,
  sourceRef: "r", content: `内容${i}`, score: 1,
}));

describe("gradeNode", () => {
  it("过滤出相关文档并生成反馈", async () => {
    vi.doMock("../../llm/factory.js", () => fakeModel([
      { docId: "c0", relevant: true, reason: "直接回答问题" },
      { docId: "c1", relevant: false, reason: "无关主题" },
    ]));
    vi.resetModules();
    const { gradeNode } = await import("./grade.js");
    const out = await gradeNode({ question: "q", candidates: docs(2), messages: [] } as never);
    expect(out.relevantDocs.map((d) => d.chunkId)).toEqual(["c0"]);
    expect(out.graphSteps[0].data.relevant).toBe(1);
  });
  it("全部无关时 feedback 非空", async () => {
    vi.doMock("../../llm/factory.js", () => fakeModel([
      { docId: "c0", relevant: false, reason: "讲的是物流" },
    ]));
    vi.resetModules();
    const { gradeNode } = await import("./grade.js");
    const out = await gradeNode({ question: "q", candidates: docs(1), messages: [] } as never);
    expect(out.relevantDocs).toHaveLength(0);
    expect(out.rewriteFeedback!.length).toBeGreaterThan(0);
  });
});
