import { describe, expect, it } from "vitest";
import { fallbackNode } from "./fallback.js";

describe("fallbackNode", () => {
  it("返回拒答文本并记录步骤", async () => {
    const out = await fallbackNode({} as never);
    expect(out.answer).toContain("没有足够的信息");
    expect(out.citations).toEqual([]);
    expect(out.graphSteps[0].node).toBe("fallback");
  });
});
