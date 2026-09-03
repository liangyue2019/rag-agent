"use client";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL!;
type Chunk = { seq: number; content: string; tokenCount: number };
type Hit = { chunkId: string; docTitle: string; score: number; preview: string };

export default function DocumentDetail() {
  const { id } = useParams<{ id: string }>() ?? {};
  const [query, setQuery] = useState("");
  const { data: chunks = [] } = useQuery<Chunk[]>({
    queryKey: ["chunks", id],
    enabled: !!id,
    queryFn: async () => (await fetch(`${API}/api/documents/${id}/chunks`)).json(),
  });
  const { data: hits, refetch, isFetching } = useQuery<Hit[]>({
    queryKey: ["retrieval-test", query, id],
    enabled: false,
    queryFn: async () => (await fetch(`${API}/api/retrieval/test`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ query, topK: 5 }),
    })).json(),
  });

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">文档详情</h1>
      <section>
        <h2 className="mb-2 font-medium">分块预览（{chunks.length} 块）</h2>
        <div className="space-y-2">
          {chunks.map((c) => (
            <div key={c.seq} className="rounded border bg-white p-3 text-sm">
              <div className="mb-1 text-xs text-gray-400">#{c.seq} · {c.tokenCount} 字</div>
              {c.content}
            </div>
          ))}
        </div>
      </section>
      <section>
        <h2 className="mb-2 font-medium">检索测试</h2>
        <div className="flex gap-2">
          <input className="flex-1 rounded border px-3 py-2" value={query}
            onChange={(e) => setQuery(e.target.value)} placeholder="输入查询验证召回" />
          <button className="rounded bg-black px-4 py-2 text-white disabled:opacity-50"
            disabled={!query || isFetching} onClick={() => refetch()}>测试</button>
        </div>
        <div className="mt-3 space-y-2">
          {hits?.map((h, i) => (
            <div key={h.chunkId} className="rounded border bg-white p-3 text-sm">
              <div className="text-xs text-gray-400">#{i + 1} · score {h.score.toFixed(4)} · {h.docTitle}</div>
              {h.preview}…
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
