"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";

const API = process.env.NEXT_PUBLIC_API_URL!;
type Conv = { id: string; title: string; updatedAt: string };

export function Sidebar({ activeId, onSelect, onNew }: {
  activeId?: string; onSelect: (id: string) => void; onNew: () => void;
}) {
  const qc = useQueryClient();
  const { data: convs = [] } = useQuery({
    queryKey: ["conversations"],
    queryFn: async () => (await fetch(`${API}/api/conversations`)).json(),
  });
  async function remove(id: string) {
    await fetch(`${API}/api/conversations/${id}`, { method: "DELETE" });
    if (id === activeId) onNew();
    qc.invalidateQueries({ queryKey: ["conversations"] });
  }
  return (
    <aside className="flex w-60 flex-col border-r bg-white">
      <button className="m-3 rounded border p-2 text-sm" onClick={onNew}>+ 新会话</button>
      <div className="flex-1 overflow-y-auto">
        {convs.map((c: Conv) => (
          <div key={c.id}
            className={`group flex items-center justify-between px-3 py-2 text-sm hover:bg-gray-100 ${c.id === activeId ? "bg-gray-100 font-medium" : ""}`}>
            <button className="flex-1 truncate text-left" onClick={() => onSelect(c.id)}>{c.title}</button>
            <button className="hidden text-red-400 group-hover:block" onClick={() => remove(c.id)}>×</button>
          </div>
        ))}
      </div>
    </aside>
  );
}
