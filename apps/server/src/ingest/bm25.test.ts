import { describe, expect, it } from "vitest";
import {
  tokenize, wordId, buildChunkSparse, buildQuerySparse, computeDfDelta, rollbackDf, applyDelta,
} from "./bm25.js";

describe("bm25", () => {
  it("tokenize 中文分词并小写化", () => {
    expect(tokenize("退货Policy退货")).toEqual(["退货", "policy", "退货"]);
  });
  it("wordId 确定性且为 u32", () => {
    const a = wordId("退货");
    expect(wordId("退货")).toBe(a);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThanOrEqual(0xffffffff);
    expect(wordId("退款")).not.toBe(a);
  });
  it("buildChunkSparse 的 tf 权重 = 1+ln(tf)", () => {
    const v = buildChunkSparse(["退货", "退货", "政策"]);
    expect(v.indices).toHaveLength(2);
    const tf2 = v.values[v.indices.indexOf(wordId("退货"))];
    const tf1 = v.values[v.indices.indexOf(wordId("政策"))];
    expect(tf2).toBeCloseTo(1 + Math.log(2));
    expect(tf1).toBeCloseTo(1);
  });
  it("buildQuerySparse 的 idf 加权：df 大的词权重低", () => {
    const df = new Map([["退货", 1], ["政策", 100]]);
    const v = buildQuerySparse(["退货", "政策"], df, 1000);
    const w1 = v.values[v.indices.indexOf(wordId("退货"))];
    const w2 = v.values[v.indices.indexOf(wordId("政策"))];
    expect(w1).toBeGreaterThan(w2);
  });
  it("computeDfDelta/applyDelta/rollbackDf 对称", () => {
    const df = new Map<string, number>();
    const delta = computeDfDelta([["退货", "政策"], ["政策"]]);
    applyDelta(df, delta);
    expect(df.get("退货")).toBe(1);
    expect(df.get("政策")).toBe(1);
    rollbackDf(df, delta);
    expect(df.get("退货")).toBeUndefined();
    expect(df.has("政策")).toBe(false);
  });
});
