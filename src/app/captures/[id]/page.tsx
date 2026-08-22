import { notFound } from "next/navigation";
import { ArrowLeft, Clock3 } from "lucide-react";
import Link from "next/link";

import { AIReviewPanel } from "@/components/ai-review-panel";
import { CaptureEditor } from "@/components/capture-editor";
import { ClaimWorkflowPanel } from "@/components/claim-workflow-panel";
import { getCaptureDetail, listCategories } from "@/features/capture/queries";

export const dynamic = "force-dynamic";

export default async function CapturePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [capture, categories] = await Promise.all([
    getCaptureDetail(id),
    listCategories(),
  ]);
  if (!capture) notFound();

  return (
    <div className="page-shell detail-page">
      <header className="detail-header">
        <Link className="back-link" href="/"><ArrowLeft size={16} /> 返回收集箱</Link>
        <div className="detail-meta"><Clock3 size={15} /> 更新于 {new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(capture.updatedAt))}</div>
      </header>
      <div className="detail-grid">
        <CaptureEditor capture={capture} categories={categories} key={`editor-${capture.version}`} />
        <AIReviewPanel capture={capture} categories={categories} key={`ai-${capture.version}-${capture.aiHistory[0]?.id ?? "none"}`} />
      </div>
      <ClaimWorkflowPanel claims={capture.claims} />
      {capture.revisions.length ? (
        <section className="revision-panel">
          <p className="eyebrow">Revision trail</p>
          <h2>版本痕迹</h2>
          <div className="revision-list">
            {capture.revisions.map((revision) => (
              <details key={revision.id}>
                <summary>版本 {revision.version} · {new Date(revision.createdAt).toLocaleString("zh-CN")}</summary>
                <h3>{revision.title || "未命名记录"}</h3>
                <div className="revision-context">
                  <span>对象：{revision.subject || "未填写"}</span>
                  <span>发生时间：{new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Shanghai" }).format(new Date(revision.occurredAt))}</span>
                </div>
                <p>{revision.content}</p>
              </details>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
