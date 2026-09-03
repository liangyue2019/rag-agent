import { QdrantClient } from "@qdrant/js-client-rest";
import { env } from "../config.js";

export const COLLECTION = "kb_chunks";
export const qdrant = new QdrantClient({ url: env.QDRANT_URL });

/** 幂等创建集合：dense(1024, Cosine) + sparse，命名与设计文档 7.2 一致 */
export async function ensureCollection() {
  const exists = await qdrant.collectionExists(COLLECTION);
  if (exists.exists) return;
  await qdrant.createCollection(COLLECTION, {
    vectors: { dense: { size: env.EMBEDDING_DIM, distance: "Cosine" } },
    sparse_vectors: { sparse: {} },
  });
}
