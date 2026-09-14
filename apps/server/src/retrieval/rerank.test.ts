import "dotenv/config";
import { describe, expect, it, vi } from "vitest";
import type { RetrievedDoc } from "@rag/shared";

// mock 共享状态：rerank 节点每次调用 makeRerankModel() 都得到新实例，闭包无法跨实例共享
const mockState = vi.hoisted(() => ({
  scores: [] as { docId: string; score: number }[],
  calls: 0,
}));

vi.mock("../llm/factory.js", () => ({
  makeRerankModel: () => ({
    withStructuredOutput: () => ({
      invoke: async () => {
        mockState.calls += 1;
        return { scores: mockState.scores };
      },
    }),
  }),
}));

import { rerankDocs, RERANK_MIN_SCORE } from "./rerank.js";

const mk = (chunkId: string, content = "内容"): RetrievedDoc => ({
  chunkId, documentId: "d", docTitle: "t", sourceType: "file", sourceRef: "r", content, score: 1,
});

describe("rerankDocs（mock LLM）", () => {
  it("按分数降序重排，同分保持原顺序", async () => {
    mockState.scores = [
      { docId: "a", score: 5 },
      { docId: "b", score: 8 },
      { docId: "c", score: 5 },
    ];
    const out = await rerankDocs("q", [mk("a"), mk("b"), mk("c")]);
    expect(out.map((d) => d.chunkId)).toEqual(["b", "a", "c"]);
  });

  it("低于 RERANK_MIN_SCORE 的候选被剪除", async () => {
    mockState.scores = [
      { docId: "a", score: 2 },
      { docId: "b", score: RERANK_MIN_SCORE },
      { docId: "c", score: 9 },
    ];
    const out = await rerankDocs("q", [mk("a"), mk("b"), mk("c")]);
    expect(out.map((d) => d.chunkId)).toEqual(["c", "b"]);
  });

  it("未返回 docId 的按 0 分处理（被剪）", async () => {
    mockState.scores = [{ docId: "a", score: 7 }];
    const out = await rerankDocs("q", [mk("a"), mk("b")]);
    expect(out.map((d) => d.chunkId)).toEqual(["a"]);
  });

  it("空数组直接返回，不调用 LLM", async () => {
    mockState.calls = 0;
    const out = await rerankDocs("q", []);
    expect(out).toEqual([]);
    expect(mockState.calls).toBe(0);
  });
});

const key = process.env.DEEPSEEK_API_KEY ?? "";
const hasKey = !!key && key !== "sk-placeholder";

// 集成测试：依赖真实 DeepSeek key（.env 已配置则真跑）
describe.skipIf(!hasKey)("rerankDocs（真实 DeepSeek 集成）", () => {
  it("相关文档排最前、无关被剪", async () => {
    // 解除 factory mock 并重载模块，拿到走真实 DeepSeek 的 rerankDocs
    vi.doUnmock("../llm/factory.js");
    vi.resetModules();
    // 哨兵：若 mock 未真正解除，所有 docId 得 0 分被剪光 → 本用例必失败
    mockState.scores = [{ docId: "zzz", score: 10 }];
    const { rerankDocs: realRerankDocs } = await import("./rerank.js");
    const docs = [
      mk("b", "今天天气晴朗，适合户外运动和野餐。"),
      mk("a", "本店退货需在签收后七天内申请，退款将原路返回支付账户。"),
      mk("c", "会员积分可以在生日当月兑换优惠券。"),
    ];
    const out = await realRerankDocs("退货政策是什么", docs);
    expect(out[0].chunkId).toBe("a");
    expect(out.find((d) => d.chunkId === "b")).toBeUndefined();
  }, 60_000);
});
