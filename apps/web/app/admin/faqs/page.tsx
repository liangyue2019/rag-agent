"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL!;
type Faq = { id: string; title: string; status: string; error: string | null };

export default function FaqsPage() {
  const qc = useQueryClient();
  const [form, setForm] = useState({ question: "", answer: "" });
  const { data: faqs = [] } = useQuery<Faq[]>({
    queryKey: ["faqs"],
    queryFn: async () => (await fetch(`${API}/api/documents/faqs`)).json(),
  });
  async function create() {
    if (!form.question.trim() || !form.answer.trim()) return;
    await fetch(`${API}/api/documents/faqs`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(form),
    });
    setForm({ question: "", answer: "" });
    qc.invalidateQueries({ queryKey: ["faqs"] });
  }
  async function remove(id: string) {
    await fetch(`${API}/api/documents/${id}`, { method: "DELETE" });
    qc.invalidateQueries({ queryKey: ["faqs"] });
  }
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">FAQ 管理</h1>
      <div className="space-y-2 rounded border bg-white p-4">
        <input className="w-full rounded border px-3 py-2" placeholder="问题"
          value={form.question} onChange={(e) => setForm({ ...form, question: e.target.value })} />
        <textarea className="w-full rounded border px-3 py-2" placeholder="答案"
          value={form.answer} onChange={(e) => setForm({ ...form, answer: e.target.value })} />
        <button className="rounded bg-black px-4 py-2 text-white" onClick={create}>新增</button>
      </div>
      <table className="w-full text-sm bg-white rounded border">
        <tbody>
          {faqs.map((f) => (
            <tr key={f.id} className="border-b last:border-0">
              <td className="p-3">{f.title}</td>
              <td className="p-3 w-40">{f.status === "failed" ? `❌ ${f.error?.slice(0, 30)}` : f.status === "processing" ? "⏳ 处理中" : "✅ ready"}</td>
              <td className="p-3 w-16 text-right">
                <button className="text-red-500" onClick={() => remove(f.id)}>删除</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
