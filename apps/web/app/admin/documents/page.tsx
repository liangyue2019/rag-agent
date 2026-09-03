"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL!;
type Doc = { id: string; title: string; sourceType: string; status: string; chunkCount: number; error: string | null };

export default function DocumentsPage() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState("");
  const { data: docs = [] } = useQuery<Doc[]>({
    queryKey: ["documents"],
    queryFn: async () => (await fetch(`${API}/api/documents`)).json(),
    refetchInterval: (query) => query.state.data?.some((d) => d.status === "processing") ? 2000 : false,
  });

  async function upload(file: File) {
    const fd = new FormData();
    fd.append("file", file);
    await fetch(`${API}/api/documents/upload`, { method: "POST", body: fd });
    qc.invalidateQueries({ queryKey: ["documents"] });
  }
  async function importUrl() {
    if (!url) return;
    await fetch(`${API}/api/documents/url`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url }),
    });
    setUrl("");
    qc.invalidateQueries({ queryKey: ["documents"] });
  }
  async function remove(id: string) {
    await fetch(`${API}/api/documents/${id}`, { method: "DELETE" });
    qc.invalidateQueries({ queryKey: ["documents"] });
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">知识库</h1>
      <div className="flex gap-3">
        <input ref={fileRef} type="file" hidden
          accept=".pdf,.docx,.txt,.md"
          onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
        <button className="border rounded px-4 py-2 bg-white" onClick={() => fileRef.current?.click()}>上传文档</button>
        <input className="border rounded px-3 py-2 flex-1 bg-white" placeholder="https:// 帮助页面 URL"
          value={url} onChange={(e) => setUrl(e.target.value)} />
        <button className="border rounded px-4 py-2 bg-white" onClick={importUrl}>导入网页</button>
      </div>
      <table className="w-full text-sm bg-white rounded border">
        <thead className="border-b text-left text-gray-500">
          <tr><th className="p-3">标题</th><th className="p-3">类型</th><th className="p-3">状态</th><th className="p-3">分块</th><th /></tr>
        </thead>
        <tbody>
          {docs.map((d) => (
            <tr key={d.id} className="border-b last:border-0">
              <td className="p-3">{d.title}</td>
              <td className="p-3">{d.sourceType}</td>
              <td className="p-3">{d.status === "processing" ? "⏳ 处理中"
                : d.status === "failed" ? `❌ ${d.error}` : "✅ ready"}</td>
              <td className="p-3">{d.chunkCount}</td>
              <td className="p-3 text-right">
                <button className="text-red-500" onClick={() => remove(d.id)}>删除</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
