import { Router } from "express";
import { Readable } from "node:stream";
import { v4 as uuid } from "uuid";
import { createUIMessageStream, createUIMessageStreamResponse } from "ai";
import { ChatRequest } from "@rag/shared";
import { naiveAnswer } from "../chat/naive.js";
import { buildCitations } from "../chat/citations.js";

export const chatRouter = Router();

/** 直线式 RAG 问答：LangChain token 流 → UIMessage Stream（SSE），回答后追加引用 data part */
chatRouter.post("/", async (req, res) => {
  const { content } = ChatRequest.parse(req.body);

  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      const messageId = uuid();
      const textId = uuid();
      writer.write({ type: "start", messageId });
      writer.write({ type: "start-step" });

      const { docs, stream: tokens } = await naiveAnswer(content);
      let answer = "";
      writer.write({ type: "text-start", id: textId });
      for await (const chunk of tokens) {
        const c = chunk.content;
        const text = typeof c === "string" ? c : c.map((b) => (b.type === "text" ? b.text : "")).join("");
        if (text) {
          answer += text;
          writer.write({ type: "text-delta", id: textId, delta: text });
        }
      }
      writer.write({ type: "text-end", id: textId });
      writer.write({ type: "finish-step" });
      writer.write({ type: "data-citations", id: uuid(), data: buildCitations(answer, docs) });
      writer.write({ type: "finish", finishReason: "stop" });
    },
    onError: (e) => `服务暂时不可用：${e instanceof Error ? e.message : String(e)}`,
  });

  const response = createUIMessageStreamResponse({ stream });
  res.status(response.status);
  response.headers.forEach((v, k) => res.setHeader(k, v));
  // undici Response.body 与 node:stream/web ReadableStream 类型声明不一致，桥接需断言
  Readable.fromWeb(response.body as any).pipe(res);
});
