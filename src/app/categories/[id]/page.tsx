import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ArrowUpRight, FolderOpen, Search, ShieldCheck } from "lucide-react";

import { CaptureCard } from "@/components/capture-card";
import { listCaptures } from "@/features/capture/queries";
import { getCategoryDossier } from "@/features/classification/queries";

export const dynamic = "force-dynamic";

export default async function CategoryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [dossier, captures] = await Promise.all([
    getCategoryDossier(id),
    listCaptures({ categoryId: id, limit: 100 }),
  ]);
  if (!dossier) notFound();
  const { category, metrics, claimStatuses, latestConclusions } = dossier;

  return (
    <div className="page-shell">
      <header className="collection-header">
        <div>
          <Link className="back-link" href="/"><ArrowLeft size={16} /> 返回收集箱</Link>
          <p className="eyebrow">Topic dossier</p>
          <h1>{category.name}</h1>
          <p>{category.description || `围绕“${category.name}”聚合原始记录、主张、证据与当前结论。`}</p>
        </div>
        <FolderOpen size={32} />
      </header>

      <section className="dossier-overview" aria-label="主题概览">
        <div className="dossier-metrics">
          <article><strong>{metrics.activeCaptures}</strong><span>活跃记录</span><small>{metrics.archivedCaptures} 条已归档</small></article>
          <article><strong>{metrics.claims}</strong><span>结构化主张</span><small>{claimStatuses.investigating} 条调查中</small></article>
          <article><strong>{metrics.trustedEvidence}</strong><span>有效采纳证据</span><small>共 {metrics.evidence} 条证据材料</small></article>
          <article><strong>{metrics.concludedClaims}</strong><span>已有人工结论</span><small>{claimStatuses.ready_for_review} 条待审核</small></article>
        </div>
        <Link className="button button-dark" href={`/search?category=${category.id}`}><Search size={15} /> 在主题内检索</Link>
      </section>

      {latestConclusions.length ? (
        <section className="content-section dossier-conclusions">
          <div className="section-title"><div><p className="eyebrow">Latest assessments</p><h2>当前结论</h2></div><span>最近 {latestConclusions.length} 条</span></div>
          <div className="dossier-conclusion-list">
            {latestConclusions.map((conclusion) => (
              <Link className={`dossier-conclusion-card is-${conclusion.assessment}`} href={`/captures/${conclusion.captureId}#claims`} key={conclusion.id}>
                <header><span><ShieldCheck size={14} />{conclusion.assessment === "supported" ? "现有证据支持" : conclusion.assessment === "refuted" ? "现有证据反驳" : "证据不足"}</span><small>审核 v{conclusion.reviewNumber}</small></header>
                <h3>{conclusion.statement}</h3>
                <p>{conclusion.rationale}</p>
                {conclusion.limitations ? <aside><strong>限制与未知</strong>{conclusion.limitations}</aside> : null}
                <footer><span>来源：{conclusion.captureTitle || "未命名记录"}</span><ArrowUpRight size={16} /></footer>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <section className="content-section dossier-captures">
        <div className="section-title"><div><p className="eyebrow">Source material</p><h2>主题记录</h2></div><span>{captures.length} 条</span></div>
      {captures.length ? (
        <div className="capture-grid">
          {captures.map((capture) => <CaptureCard capture={capture} key={capture.id} />)}
        </div>
      ) : (
          <div className="empty-state"><span>00</span><h3>这个分类还是空的</h3><p>编辑记录或接受 AI 分类建议后，内容会出现在这里。</p></div>
      )}
      </section>
    </div>
  );
}
