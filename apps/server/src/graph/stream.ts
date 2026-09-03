import { HumanMessage } from "@langchain/core/messages";
import { v4 as uuid } from "uuid";
import { createUIMessageStream } from "ai";
import { buildRagGraph } from "./build.js";
import type { RagState } from "./state.js";
import type { Citation, GraphStep } from "@rag/shared";

export interface ChatTurn {
  history: { role: "user" | "assistant"; content: string }[];
  content: string;
}

export interface CollectedResult {
  answer: string;
  citations: Citation[];
  steps: GraphStep[];
}

/** 执行 RAG 图并映射为 UIMessage Stream：
 * graph-step data part 先行 → generate/chatReply 的 token 增量 → citations 收尾。
 * 终态 answer/citations 取自节点级 on_chain_end 输出（方案 A：无需 checkpointer），
 * 同时累积到 collected 供路由层落库；无 token 事件时（fallback 静态文案）整段写出。 */
export function runGraphAsStream(turn: ChatTurn, collected: CollectedResult) {
  return createUIMessageStream({
    execute: async ({ writer }) => {
      const messageId = uuid();
      const textId = uuid();
      writer.write({ type: "start", messageId });
      writer.write({ type: "start-step" });

      const graph = buildRagGraph();
      const history = turn.history.slice(-10).map((m) =>
        new HumanMessage(`[${m.role}] ${m.content}`));
      const input = {
        messages: [...history, new HumanMessage(turn.content)],
        question: turn.content,
      };

      let textStarted = false;
      let finalAnswer: string | undefined;
      let finalCitations: Citation[] = [];

      const stream = await graph.streamEvents(input, { version: "v2" });
      for await (const ev of stream) {
        const node = (ev.metadata ?? {}) as { langgraph_node?: string };

        // 1) generate/chatReply 节点内 LLM 的 token 流
        if (
          ev.event === "on_chat_model_stream" &&
          (node.langgraph_node === "generate" || node.langgraph_node === "chatReply")
        ) {
          const chunk = (ev.data as { chunk?: { content?: unknown } } | undefined)?.chunk;
          let text = "";
          if (typeof chunk?.content === "string") text = chunk.content;
          else if (Array.isArray(chunk?.content)) {
            text = (chunk.content as Array<{ text?: string }>)
              .map((b) => b.text ?? "").join("");
          }
          if (!text) continue;
          if (!textStarted) {
            writer.write({ type: "text-start", id: textId });
            textStarted = true;
          }
          writer.write({ type: "text-delta", id: textId, delta: text });
          collected.answer += text;
        }

        // 2) 节点级 on_chain_end（name 与 langgraph_node 相同；排除 ChannelWrite/Branch 等内部链）
        if (ev.event === "on_chain_end" && ev.name === node.langgraph_node) {
          const out = (ev.data as { output?: Partial<RagState> } | undefined)?.output;
          if (out?.graphSteps?.length) {
            for (const s of out.graphSteps) {
              writer.write({ type: "data-graph-step", id: uuid(), data: s });
              collected.steps.push(s);
            }
          }
          if (
            node.langgraph_node === "generate" ||
            node.langgraph_node === "chatReply" ||
            node.langgraph_node === "fallback"
          ) {
            if (typeof out?.answer === "string") finalAnswer = out.answer;
            if (out?.citations?.length) finalCitations = out.citations;
          }
        }
      }

      // 3) token 流收尾；无 token 事件时用终态答案整段写出（fallback 拒答文案等）
      if (textStarted) {
        writer.write({ type: "text-end", id: textId });
      } else if (finalAnswer) {
        writer.write({ type: "text-start", id: textId });
        writer.write({ type: "text-delta", id: textId, delta: finalAnswer });
        writer.write({ type: "text-end", id: textId });
      }
      // 节点返回值为权威答案（与 token 累积一致，mock 场景则补齐）
      if (finalAnswer !== undefined) collected.answer = finalAnswer;

      writer.write({ type: "finish-step" });
      if (finalCitations.length) {
        writer.write({ type: "data-citations", id: uuid(), data: finalCitations });
        collected.citations = finalCitations;
      }
      writer.write({ type: "finish", finishReason: "stop" });
    },
    onError: (e) => `服务暂时不可用：${e instanceof Error ? e.message : String(e)}`,
  });
}
