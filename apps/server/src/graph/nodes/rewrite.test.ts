import { describe, expect, it, vi } from "vitest";

// 按用例切换模型的返回，验证"模型给多少个变体都不影响契约"
let modelReturns: string[] = ["改写1"];

vi.mock("../../llm/factory.js", () => ({
  makeChatModel: () => ({
    withStructuredOutput: () => ({
      invoke: async () => ({ queries: modelReturns }),
    }),
  }),
}));

const { rewriteNode } = await import("./rewrite.js");

describe("rewriteNode", () => {
  it("首轮 queries 以原始问题开头", async () => {
    modelReturns = ["改写1"];
    const state = { question: "原始问题", messages: [], retrievalCount: 0, rewriteFeedback: "" } as never;
    const out = await rewriteNode(state);
    expect(out.queries).toEqual(["原始问题", "改写1"]);
  });

  it("重试轮正常输出（feedback 注入由实现保证，此处验证输出契约）", async () => {
    modelReturns = ["改写1"];
    const state = { question: "q", messages: [], retrievalCount: 1, rewriteFeedback: "缺少价格信息" } as never;
    const out = await rewriteNode(state);
    expect(out.queries).toEqual(["q", "改写1"]);
  });

  it("模型多给变体时截断到 2 个（不因超量报解析错误）", async () => {
    modelReturns = ["变体1", "变体2", "变体3", "变体4"];
    const state = { question: "q", messages: [], retrievalCount: 0, rewriteFeedback: "" } as never;
    const out = await rewriteNode(state);
    expect(out.queries).toEqual(["q", "变体1", "变体2"]);
  });

  it("模型重复返回原问题时去重", async () => {
    modelReturns = ["q", "变体1"];
    const state = { question: "q", messages: [], retrievalCount: 0, rewriteFeedback: "" } as never;
    const out = await rewriteNode(state);
    expect(out.queries).toEqual(["q", "变体1"]);
  });
});
