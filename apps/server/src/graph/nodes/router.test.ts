import { describe, expect, it, vi } from "vitest";
import { routerNode } from "./router.js";

vi.mock("../../llm/factory.js", () => ({
  makeChatModel: () => ({
    withStructuredOutput: () => ({
      invoke: async () => ({ route: "chat" as const }),
    }),
  }),
}));

describe("routerNode", () => {
  it("闲聊 → route=chat 并记录 graphSteps", async () => {
    const state = { question: "你好", messages: [] } as never;
    const out = await routerNode(state);
    expect(out.route).toBe("chat");
    // Partial 出参 + GraphStep 联合类型：用 toEqual 收窄断言（运行时语义不变）
    expect(out.graphSteps).toEqual([
      { node: "router", summary: expect.stringContaining("闲聊") },
    ]);
  });
});
