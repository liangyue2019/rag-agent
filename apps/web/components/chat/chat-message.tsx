import type { UIMessage } from "ai";

// 与 @rag/shared 的 Citation 保持一致（前端本地声明，避免跨包类型引用配置）
interface Citation {
  n: number;
  chunkId: string;
  docTitle: string;
  sourceRef: string;
  preview: string;
}

export function ChatMessage({ message }: { message: UIMessage }) {
  if (message.role === "user") {
    return (
      <div className="ml-auto max-w-[80%] rounded-lg bg-black p-3 text-white">
        {message.parts.map((p, i) =>
          p.type === "text" ? <span key={i}>{p.text}</span> : null,
        )}
      </div>
    );
  }
  const text = message.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");
  const citations = message.parts.find(
    (p): p is { type: "data-citations"; data: unknown } =>
      p.type === "data-citations",
  )?.data as Citation[] | undefined;
  return (
    <div className="max-w-[80%] rounded-lg bg-white p-3 shadow-sm">
      <div className="whitespace-pre-wrap">{text}</div>
      {citations && citations.length > 0 && (
        <div className="mt-2 border-t pt-2 text-xs text-gray-500">
          引用：{citations.map((c) => `[${c.n}] ${c.docTitle}`).join("、")}
        </div>
      )}
    </div>
  );
}
