import Link from "next/link";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="border-b bg-white px-6 py-3 flex gap-6 text-sm">
        <Link href="/admin/documents" className="font-medium">知识库</Link>
        <Link href="/admin/faqs" className="text-gray-600">FAQ</Link>
        <Link href="/admin/conversations" className="text-gray-600">会话</Link>
        <Link href="/" className="ml-auto text-gray-600">← 聊天</Link>
      </nav>
      <main className="mx-auto max-w-4xl p-6">{children}</main>
    </div>
  );
}
