import { Router } from "express";
import { Readable } from "node:stream";
import { v4 as uuid } from "uuid";
import { createUIMessageStreamResponse } from "ai";
import { eq, asc } from "drizzle-orm";
import { db } from "../db/client.js";
import { conversations, messages } from "../db/schema.js";
import { runGraphAsStream, type CollectedResult } from "../graph/stream.js";
import { ChatRequest } from "@rag/shared";

export const chatRouter = Router();

/** 图驱动 RAG 问答：无 conversationId 则新建会话，历史消息注入图输入；
 * 流式结束后整轮落库（answer 为空说明走了 error 路径，不落库） */
chatRouter.post("/", async (req, res) => {
  const { conversationId, content } = ChatRequest.parse(req.body);

  let convId = conversationId;
  let history: { role: "user" | "assistant"; content: string }[] = [];
  if (!convId) {
    convId = uuid();
    await db.insert(conversations).values({ id: convId, title: content.slice(0, 20) });
  } else {
    const rows = await db.select().from(messages)
      .where(eq(messages.conversationId, convId)).orderBy(asc(messages.createdAt));
    history = rows.map((r) => ({ role: r.role as "user" | "assistant", content: r.content }));
  }
  await db.insert(messages).values({ id: uuid(), conversationId: convId, role: "user", content });

  const collected: CollectedResult = { answer: "", citations: [], steps: [] };
  const stream = runGraphAsStream({ history, content }, collected);

  const response = createUIMessageStreamResponse({ stream });
  res.status(response.status);
  response.headers.forEach((v, k) => res.setHeader(k, v));
  // undici Response.body 与 node:stream/web ReadableStream 类型声明不一致，桥接需断言
  const node = Readable.fromWeb(response.body as any);
  node.pipe(res);
  node.on("close", () => {
    // better-sqlite3 为同步驱动，语句用 .run() 立即执行；citations/graphSteps 为 json mode 列直接传数组
    if (collected.answer) {
      db.insert(messages).values({
        id: uuid(), conversationId: convId!, role: "assistant",
        content: collected.answer, citations: collected.citations, graphSteps: collected.steps,
      }).run();
      db.update(conversations).set({ updatedAt: new Date() })
        .where(eq(conversations.id, convId!)).run();
    }
  });
});
