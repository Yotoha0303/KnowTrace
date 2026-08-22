import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, FolderOpen } from "lucide-react";

import { CaptureCard } from "@/components/capture-card";
import { listCaptures, listCategories } from "@/features/capture/queries";

export const dynamic = "force-dynamic";

export default async function CategoryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [allCategories, captures] = await Promise.all([
    listCategories(),
    listCaptures({ categoryId: id, limit: 100 }),
  ]);
  const category = allCategories.find((item) => item.id === id);
  if (!category) notFound();

  return (
    <div className="page-shell">
      <header className="collection-header">
        <div>
          <Link className="back-link" href="/"><ArrowLeft size={16} /> 返回收集箱</Link>
          <p className="eyebrow">Category</p>
          <h1>{category.name}</h1>
          <p>{category.description || `归入“${category.name}”的全部活跃记录。`}</p>
        </div>
        <FolderOpen size={32} />
      </header>
      {captures.length ? (
        <div className="capture-grid">
          {captures.map((capture) => <CaptureCard capture={capture} key={capture.id} />)}
        </div>
      ) : (
        <div className="empty-state"><span>00</span><h3>这个分类还是空的</h3><p>编辑记录或接受 AI 分类建议后，内容会出现在这里。</p></div>
      )}
    </div>
  );
}
