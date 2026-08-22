import Link from "next/link";
import { ArrowLeft, Archive } from "lucide-react";

import { CaptureCard } from "@/components/capture-card";
import { listCaptures } from "@/features/capture/queries";

export const dynamic = "force-dynamic";

export default async function ArchivedPage() {
  const captures = await listCaptures({ status: "archived", limit: 100 });
  return (
    <div className="page-shell">
      <header className="collection-header">
        <div>
          <Link className="back-link" href="/"><ArrowLeft size={16} /> 返回收集箱</Link>
          <p className="eyebrow">Archive</p>
          <h1>已归档</h1>
          <p>不再活跃，但仍保留原文、版本和 AI 处理痕迹。</p>
        </div>
        <Archive size={32} />
      </header>
      {captures.length ? (
        <div className="capture-grid">
          {captures.map((capture) => <CaptureCard capture={capture} key={capture.id} />)}
        </div>
      ) : (
        <div className="empty-state"><span>00</span><h3>归档箱是空的</h3><p>归档记录后，它们会出现在这里。</p></div>
      )}
    </div>
  );
}
