import { describe, expect, it } from "vitest";
import { buildCitations } from "./citations.js";

const docs = [
  { chunkId: "c1", documentId: "d", docTitle: "A.pdf", sourceType: "file" as const, sourceRef: "A.pdf", content: "x".repeat(200), score: 1 },
  { chunkId: "c2", documentId: "d", docTitle: "B.pdf", sourceType: "file" as const, sourceRef: "B.pdf", content: "y", score: 1 },
];

describe("buildCitations", () => {
  it("提取回答中实际使用的编号", () => {
    const c = buildCitations("政策是七天 [1]，费用见 [2]。", docs);
    expect(c.map((x) => x.n)).toEqual([1, 2]);
    expect(c[0].docTitle).toBe("A.pdf");
    expect(c[0].preview.length).toBe(120);
  });
  it("未引用的文档不出现", () => {
    const c = buildCitations("只有一条 [1]。", docs);
    expect(c).toHaveLength(1);
  });
  it("越界编号被忽略", () => {
    const c = buildCitations("[3] 不存在", docs);
    expect(c).toHaveLength(0);
  });
});
