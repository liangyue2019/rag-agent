import { describe, expect, it, vi } from "vitest";
import { rewriteNode } from "./rewrite.js";

vi.mock("../../llm/factory.js", () => ({
  makeChatModel: () => ({
    withStructuredOutput: () => ({
      invoke: async () => ({ queries: ["改写1"] }),
    }),
  }),
}));

describe("rewriteNode", () => {
  it("首轮 queries 以原始问题开头", async () => {
    const state = { question: "原始问题", messages: [], retrievalCount: 0, rewriteFeedback: "" } as never;
    const out = await rewriteNode(state);
    expect(out.queries).toEqual(["原始问题", "改写1"]);
  });
  it("重试轮正常输出（feedback 注入由实现保证，此处验证输出契约）", async () => {
    const state = { question: "q", messages: [], retrievalCount: 1, rewriteFeedback: "缺少价格信息" } as never;
    const out = await rewriteNode(state);
    expect(out.queries).toEqual(["q", "改写1"]);
  });
});
