"use client";
import { useState } from "react";

// 与 @rag/shared 的 GraphStep 保持一致（前端本地声明，避免跨包类型引用配置），
// 供 chat-message.tsx 收集 data-graph-step part 时复用
export type GraphStep =
  | { node: "router"; summary: string }
  | { node: "rewrite"; data: { queries: string[]; round: number } }
  | { node: "retrieve"; data: { queries: string[]; candidates: number } }
  | { node: "grade"; data: { relevant: number; irrelevant: number; feedback: string } }
  | { node: "generate"; data: { docs: number } }
  | { node: "fallback"; summary: string }
  | { node: "chatReply"; summary: string };

const NODE_LABEL: Record<GraphStep["node"], string> = {
  router: "意图识别", rewrite: "查询改写", retrieve: "混合检索",
  grade: "相关性评分", generate: "生成回答", fallback: "拒答", chatReply: "直接回复",
};

export function ThinkingPanel({ steps }: { steps: GraphStep[] }) {
  const [open, setOpen] = useState(false);
  if (steps.length === 0) return null;
  return (
    <div className="mt-2 text-xs text-gray-500">
      <button onClick={() => setOpen(!open)} className="flex items-center gap-1 hover:text-gray-700">
        <span>{open ? "▾" : "▸"}</span> 思考过程（{steps.length} 步）
      </button>
      {open && (
        <ol className="mt-2 space-y-1 border-l-2 pl-3">
          {steps.map((s, i) => (
            <li key={i}>
              <span className="font-medium">{NODE_LABEL[s.node]}</span>
              {"summary" in s && s.summary ? ` — ${s.summary}` : ""}
              {"data" in s && s.node === "rewrite" && (
                <div className="text-gray-400">查询：{s.data.queries.join(" / ")}</div>
              )}
              {"data" in s && s.node === "retrieve" && (
                <div className="text-gray-400">候选 {s.data.candidates} 条</div>
              )}
              {"data" in s && s.node === "grade" && (
                <div className="text-gray-400">相关 {s.data.relevant} / 无关 {s.data.irrelevant}</div>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
