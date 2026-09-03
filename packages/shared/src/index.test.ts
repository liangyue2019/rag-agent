import { describe, expect, it } from "vitest";
import { ChatRequest, DocumentDto } from "./index";

describe("shared schemas", () => {
  it("ChatRequest 校验合法输入", () => {
    const r = ChatRequest.parse({ content: "退货政策？" });
    expect(r.content).toBe("退货政策？");
    expect(r.conversationId).toBeUndefined();
  });
  it("ChatRequest 拒绝空内容", () => {
    expect(() => ChatRequest.parse({ content: "" })).toThrow();
  });
  it("DocumentDto 解析完整对象", () => {
    const d = DocumentDto.parse({
      id: "d1",
      title: "t",
      sourceType: "faq",
      sourceRef: "",
      status: "ready",
      error: null,
      chunkCount: 1,
      createdAt: "2026-01-01",
    });
    expect(d.status).toBe("ready");
  });
});
