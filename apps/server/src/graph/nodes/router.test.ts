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
    expect(out.graphSteps[0].node).toBe("router");
    expect(out.graphSteps[0].summary).toContain("闲聊");
  });
});
