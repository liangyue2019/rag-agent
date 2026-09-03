import "dotenv/config";
import { describe, expect, it } from "vitest";
import { hybridSearch } from "./hybrid.js";

const key = process.env.ZHIPU_API_KEY ?? "";
const hasKey = !!key && key !== "sk-placeholder";

// 集成测试：依赖真实智谱 key 与运行中的 Qdrant，placeholder key 下 skip（待真实 key）
describe.skipIf(!hasKey)("hybridSearch（集成）", () => {
  it("返回字段完整且不抛错", async () => {
    const hits = await hybridSearch("测试查询", 5);
    for (const h of hits) {
      expect(h).toHaveProperty("chunkId");
      expect(h).toHaveProperty("score");
      expect(h).toHaveProperty("docTitle");
    }
  }, 60_000);
});
