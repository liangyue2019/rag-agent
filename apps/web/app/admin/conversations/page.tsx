"use client";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL!;
type Conv = { id: string; title: string; createdAt: string; updatedAt: string };
type Msg = {
  id: string; role: string; content: string;
  graphSteps: Array<{ node: string }> | null;
};
type Detail = { id: string; title: string; messages: Msg[] };

export default function ConversationsPage() {
  const [openId, setOpenId] = useState<string>();
  const { data: convs = [] } = useQuery<Conv[]>({
    queryKey: ["conversations"],
    queryFn: async () => (await fetch(`${API}/api/conversations`)).json(),
  });
  const { data: detail } = useQuery<Detail>({
    queryKey: ["conversation", openId],
    enabled: !!openId,
    queryFn: async () => (await fetch(`${API}/api/conversations/${openId}`)).json(),
  });
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">会话历史</h1>
      <div className="space-y-2">
        {convs.map((c) => (
          <div key={c.id} className="rounded border bg-white">
            <button className="w-full p-3 text-left text-sm hover:bg-gray-50"
              onClick={() => setOpenId(openId === c.id ? undefined : c.id)}>
              {c.title}
            </button>
            {openId === c.id && detail?.messages?.map((m) => (
              <div key={m.id} className={`p-3 text-sm border-t ${m.role === "user" ? "bg-gray-50" : ""}`}>
                <div className="text-xs text-gray-400">{m.role}</div>
                {m.content}
                {m.graphSteps?.length ? (
                  <div className="mt-1 text-xs text-gray-400">
                    步骤：{m.graphSteps.map((s) => s.node).join(" → ")}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
