import { Router } from "express";
import { desc, eq, asc } from "drizzle-orm";
import { db } from "../db/client.js";
import { conversations, messages } from "../db/schema.js";
import type { ConversationDto, MessageDto, Citation, GraphStep } from "@rag/shared";

export const conversationsRouter = Router();

const toConv = (c: typeof conversations.$inferSelect): ConversationDto => ({
  id: c.id,
  title: c.title,
  createdAt: c.createdAt.toISOString(),
  updatedAt: c.updatedAt.toISOString(),
});

conversationsRouter.get("/", async (_req, res) => {
  const rows = await db.select().from(conversations).orderBy(desc(conversations.updatedAt));
  res.json(rows.map(toConv));
});

conversationsRouter.get("/:id", async (req, res) => {
  const conv = (await db.select().from(conversations).where(eq(conversations.id, req.params.id)))[0];
  if (!conv) return res.status(404).json({ error: "会话不存在" });
  const rows = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, req.params.id))
    .orderBy(asc(messages.createdAt));
  const msgs: MessageDto[] = rows.map((m) => ({
    id: m.id,
    role: m.role as "user" | "assistant",
    content: m.content,
    citations: (m.citations ?? null) as Citation[] | null,
    graphSteps: (m.graphSteps ?? null) as GraphStep[] | null,
    createdAt: m.createdAt.toISOString(),
  }));
  res.json({ ...toConv(conv), messages: msgs });
});

conversationsRouter.delete("/:id", async (req, res) => {
  await db.delete(conversations).where(eq(conversations.id, req.params.id));
  res.status(204).end();
});
