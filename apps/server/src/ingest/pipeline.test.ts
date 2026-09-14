import "dotenv/config";
import { describe, expect, it } from "vitest";
import { v4 as uuid } from "uuid";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { documents } from "../db/schema.js";
import { enqueueIngest, deleteDocumentFully } from "./pipeline.js";
import { ensureCollection } from "../qdrant/client.js";
import { waitReady } from "./waitReady.js";

// pipeline 只依赖 embedding 角色（向量化入库），chat/rerank 不在此链路
const key = process.env.EMBEDDING_API_KEY ?? "";
const hasKey = !!key && key !== "sk-placeholder";

describe.skipIf(!hasKey)("ingest pipeline（集成）", () => {
  it("FAQ 全流程：processing→ready→Qdrant 可检索→删除干净", async () => {
    await ensureCollection();
    const id = uuid();
    await db.insert(documents).values({
      id, title: "测试FAQ：发货时间", sourceType: "faq", sourceRef: "",
    });
    enqueueIngest({ documentId: id, question: "多久发货？", answer: "下单后 48 小时内发货。" });
    await waitReady(id);

    const doc = (await db.select().from(documents).where(eq(documents.id, id)))[0];
    expect(doc.status).toBe("ready");
    expect(doc.chunkCount).toBe(1);

    const after = await qdrantScrollByDocumentId(id);
    expect(after.length).toBe(1);

    await deleteDocumentFully(id);
    const post = await qdrantScrollByDocumentId(id);
    expect(post).toHaveLength(0);
  }, 90_000);

  async function qdrantScrollByDocumentId(documentId: string) {
    const { qdrant, COLLECTION } = await import("../qdrant/client.js");
    const r = await qdrant.scroll(COLLECTION, {
      filter: { must: [{ key: "documentId", match: { value: documentId } }] },
      limit: 10,
    });
    return r.points;
  }
});
