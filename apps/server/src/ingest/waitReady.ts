import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { documents } from "../db/schema.js";

export async function waitReady(id: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const doc = (await db.select().from(documents).where(eq(documents.id, id)))[0];
    if (doc?.status === "ready") return;
    if (doc?.status === "failed") throw new Error(`ingest failed: ${doc.error}`);
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("waitReady 超时");
}
