import { CaptureCard } from "@/components/capture-card";
import { QuickCaptureForm } from "@/components/quick-capture-form";
import { listCaptures, listCategories } from "@/features/capture/queries";
import { toDateTimeLocalValue } from "@/features/capture/datetime";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [captures, categories] = await Promise.all([
    listCaptures({ limit: 30 }),
    listCategories(),
  ]);

  return (
    <div className="page-shell">
      <header className="page-header">
        <div>
          <p className="eyebrow">个人知识输入层</p>
          <h1>先留下，再慢慢想清楚。</h1>
          <p className="page-intro">
            输入可以散碎，写回必须经过审阅。每一次修改和 AI 处理都会留下痕迹。
          </p>
        </div>
        <div className="status-pill"><span /> 本地工作区</div>
      </header>

      <QuickCaptureForm
        categories={categories}
        defaultOccurredAt={toDateTimeLocalValue(new Date())}
      />

      <section className="content-section">
        <div className="section-title">
          <div>
            <p className="eyebrow">Inbox</p>
            <h2>最近记录</h2>
          </div>
          <span>{captures.length} 条</span>
        </div>
        {captures.length === 0 ? (
          <div className="empty-state">
            <span>01</span>
            <h3>从一个关键词开始</h3>
            <p>无需先想好结构。记录原文，分类和 AI 建议可以稍后补上。</p>
          </div>
        ) : (
          <div className="capture-grid">
            {captures.map((capture) => <CaptureCard capture={capture} key={capture.id} />)}
          </div>
        )}
      </section>
    </div>
  );
}
