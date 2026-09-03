"use client";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ChatMessage } from "@/components/chat/chat-message";
import { Sidebar } from "@/components/chat/sidebar";

const API = process.env.NEXT_PUBLIC_API_URL;

// 后端 /api/chat 契约为 { content }，而非 AI SDK 默认的 { id, messages, trigger }，
// 通过 prepareSendMessagesRequest 把最后一条用户消息的文本映射为 content。
// conversationId 走 sendMessage 第二参的 per-call body：useChat 的 Chat 实例只在
// 首渲染构造并永久持有 transport（组件内重建 transport 不生效），而每次 sendMessage
// 的 options.body 会合并进 prepareSendMessagesRequest 的入参 body，
// 因此 transport 保持模块级单例即可随请求携带当前会话 id。
const transport = new DefaultChatTransport({
  api: `${API}/api/chat`,
  prepareSendMessagesRequest: ({ messages, body }) => ({
    body: {
      // 无激活会话时为 undefined，JSON.stringify 会省略该字段 → 后端新建会话
      conversationId: body?.conversationId as string | undefined,
      content:
        messages
          .filter((m) => m.role === "user")
          .at(-1)
          ?.parts.flatMap((p) => (p.type === "text" ? [p.text] : []))
          .join("") ?? "",
    },
  }),
});

// GET /api/conversations 返回 ConversationDto（按 updatedAt 倒序）
type Conv = { id: string; title: string; updatedAt: string };

export default function Home() {
  const [input, setInput] = useState("");
  const [activeId, setActiveId] = useState<string | undefined>();
  const qc = useQueryClient();
  const { messages, setMessages, sendMessage, status, error, clearError } = useChat({
    transport,
  });

  // 一轮流结束（sendMessage 的 promise 在成功/出错/中止后都会 resolve）后刷新
  // 会话列表：fetchQuery 与 Sidebar 的 useQuery 共享 ["conversations"] 缓存，
  // 顺带驱动侧栏更新；若无激活会话（首条消息刚新建会话），按 updatedAt 倒序
  // 认领第一条。函数式 setState 读取 await 之后的最新值，避免闭包过期
  async function refreshAfterTurn() {
    const convs = await qc.fetchQuery({
      queryKey: ["conversations"],
      queryFn: async () => (await fetch(`${API}/api/conversations`)).json() as Promise<Conv[]>,
    });
    setActiveId((prev) => prev ?? convs[0]?.id);
  }

  // 加载历史会话：MessageDto → UIMessage（仅文本 part；citations/graphSteps 不重放，
  // 思考过程与引用 chip 只在当轮流式过程中展示）
  async function selectConversation(id: string) {
    const res = await fetch(`${API}/api/conversations/${id}`);
    if (!res.ok) return;
    const conv = await res.json() as {
      messages: { id: string; role: "user" | "assistant"; content: string }[];
    };
    setMessages(conv.messages.map((m) => ({
      id: m.id,
      role: m.role,
      parts: [{ type: "text", text: m.content }],
    })));
    setActiveId(id);
  }

  function newConversation() {
    setActiveId(undefined);
    setMessages([]);
  }

  return (
    <div className="flex h-screen">
      <Sidebar activeId={activeId} onSelect={selectConversation} onNew={newConversation} />
      <main className="mx-auto flex h-screen max-w-3xl flex-1 flex-col">
        <header className="border-b p-4 font-bold">RAG 知识库客服</header>
        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {messages.map((m) => (
            <ChatMessage key={m.id} message={m} />
          ))}
          {status === "submitted" && <div className="text-gray-400">思考中…</div>}
          {error && (
            <div className="rounded bg-red-50 p-3 text-red-600">{error.message}</div>
          )}
        </div>
        <form
          className="flex gap-2 border-t p-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!input.trim() || status === "submitted" || status === "streaming")
              return;
            const text = input;
            setInput("");
            clearError();
            await sendMessage({ text }, { body: { conversationId: activeId } });
            await refreshAfterTurn();
          }}
        >
          <input
            className="flex-1 rounded border px-3 py-2"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="输入问题，如：退货政策是什么？"
          />
          <button
            className="rounded bg-black px-4 py-2 text-white disabled:opacity-50"
            disabled={status === "submitted" || status === "streaming"}
          >
            发送
          </button>
        </form>
      </main>
    </div>
  );
}
