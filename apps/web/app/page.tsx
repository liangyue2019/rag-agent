"use client";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useState } from "react";
import { ChatMessage } from "@/components/chat/chat-message";

// 后端 /api/chat 契约为 { content }，而非 AI SDK 默认的 { id, messages, trigger }，
// 通过 prepareSendMessagesRequest 把最后一条用户消息的文本映射为 content
const transport = new DefaultChatTransport({
  api: `${process.env.NEXT_PUBLIC_API_URL}/api/chat`,
  prepareSendMessagesRequest: ({ messages }) => ({
    body: {
      content:
        messages
          .filter((m) => m.role === "user")
          .at(-1)
          ?.parts.flatMap((p) => (p.type === "text" ? [p.text] : []))
          .join("") ?? "",
    },
  }),
});

export default function Home() {
  const [input, setInput] = useState("");
  const { messages, sendMessage, status, error, clearError } = useChat({
    transport,
  });

  return (
    <main className="mx-auto flex h-screen max-w-3xl flex-col">
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
        onSubmit={(e) => {
          e.preventDefault();
          if (!input.trim() || status === "submitted" || status === "streaming")
            return;
          clearError();
          sendMessage({ text: input });
          setInput("");
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
  );
}
