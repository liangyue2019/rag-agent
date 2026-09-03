import type { UIMessage } from "ai";
import { ThinkingPanel, type GraphStep } from "@/components/chat/thinking-panel";

// 与 @rag/shared 的 Citation 保持一致（前端本地声明，避免跨包类型引用配置）
interface Citation {
  n: number;
  chunkId: string;
  docTitle: string;
  sourceRef: string;
  preview: string;
}

// 回答文本按 [n] 标记分段：编号命中引用则渲染为上标 chip（悬停显示来源详情），否则原样文本
function renderWithCitationChips(text: string, citations?: Citation[]) {
  if (!citations?.length) return text;
  return text.split(/(\[\d+\])/g).map((seg, i) => {
    const m = seg.match(/^\[(\d+)\]$/);
    if (!m) return <span key={i}>{seg}</span>;
    const c = citations.find((x) => x.n === Number(m[1]));
    return c
      ? <sup key={i} className="ml-0.5 cursor-pointer rounded bg-blue-100 px-1 text-blue-600" title={`${c.docTitle}: ${c.preview}`}>[{c.n}]</sup>
      : <span key={i}>{seg}</span>;
  });
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
  const steps = message.parts
    .filter(
      (p): p is { type: "data-graph-step"; data: unknown } =>
        p.type === "data-graph-step",
    )
    .map((p) => p.data as GraphStep);
  return (
    <div className="max-w-[80%] rounded-lg bg-white p-3 shadow-sm">
      <div className="whitespace-pre-wrap">{renderWithCitationChips(text, citations)}</div>
      <ThinkingPanel steps={steps} />
      {citations && citations.length > 0 && (
        <div className="mt-2 border-t pt-2 text-xs text-gray-500">
          引用：{citations.map((c) => `[${c.n}] ${c.docTitle}（${c.sourceRef}）`).join("、")}
        </div>
      )}
    </div>
  );
}
