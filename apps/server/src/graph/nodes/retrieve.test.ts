import { describe, expect, it, vi } from "vitest";

vi.mock("../../retrieval/hybrid.js", () => ({
  hybridSearch: vi.fn().mockResolvedValue([
    { chunkId: "c1", documentId: "d1", docTitle: "t", sourceType: "file", sourceRef: "r", content: "甲", score: 1 },
    { chunkId: "c2", documentId: "d1", docTitle: "t", sourceType: "file", sourceRef: "r", content: "乙", score: 2 },
    { chunkId: "c1", documentId: "d1", docTitle: "t", sourceType: "file", sourceRef: "r", content: "甲", score: 3 },
  ]),
}));

describe("retrieveNode", () => {
  it("多查询合并按 chunkId 去重并截断至 10", async () => {
    const { retrieveNode } = await import("./retrieve.js");
    const out = await retrieveNode({ queries: ["q1", "q2"], messages: [] } as never);
    expect(out.candidates).toHaveLength(2);
    expect(out.graphSteps[0].node).toBe("retrieve");
    expect(out.graphSteps[0].data.candidates).toBe(2);
  });
});
