import { describe, expect, it } from "vitest";
import { chunkText } from "./chunker.js";

describe("chunkText", () => {
  it("短文本返回单块", async () => {
    const r = await chunkText("退货政策：七天内可退。");
    expect(r).toHaveLength(1);
    expect(r[0].content).toContain("退货");
    expect(r[0].seq).toBe(0);
  });
  it("长文本按分隔符切分且不超上限", async () => {
    const para = "退货政策第一段内容。".repeat(80); // 400 字
    const r = await chunkText(`${para}\n\n${para}\n\n${para}`);
    expect(r.length).toBeGreaterThan(1);
    for (const c of r) expect(c.content.length).toBeLessThanOrEqual(700);
  });
  it("相邻块存在 overlap", async () => {
    // 注：overlap 以 split 片段为粒度回退，片段本身超过 overlap 时无字符级重叠；
    // 用超长无分隔片段（触发逐字切分）验证字符级 overlap
    const a = "甲".repeat(700);
    const b = "乙".repeat(700);
    const r = await chunkText(`${a}。${b}`, { overlap: 50 });
    expect(r.length).toBeGreaterThan(1);
    const tail = r[0].content.slice(-50);
    expect(r[1].content.startsWith(tail)).toBe(true);
    for (const c of r) expect(c.content.length).toBeLessThanOrEqual(700);
  });
});
