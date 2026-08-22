import Link from "next/link";
import { ArrowUpRight, Filter, Scale, Search } from "lucide-react";

import type { ClaimDTO } from "@/features/capture/queries";
import { listClaims } from "@/features/capture/queries";

export const dynamic = "force-dynamic";

const statusLabels: Record<ClaimDTO["status"], string> = {
  candidate: "候选",
  investigating: "调查中",
  ready_for_review: "待审核",
  concluded: "已形成结论",
  withdrawn: "已撤回",
};

const assessmentLabels = {
  supported: "现有证据支持",
  refuted: "现有证据反驳",
  inconclusive: "证据不足",
} as const;

const allowedStatuses = new Set<ClaimDTO["status"]>([
  "candidate",
  "investigating",
  "ready_for_review",
  "concluded",
  "withdrawn",
]);

export default async function ClaimsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const params = await searchParams;
  const query = params.q?.trim().slice(0, 100) ?? "";
  const status = allowedStatuses.has(params.status as ClaimDTO["status"])
    ? (params.status as ClaimDTO["status"])
    : undefined;
  const items = await listClaims({ query, status, limit: 100 });

  return (
    <div className="page-shell claims-page">
      <header className="collection-header">
        <div>
          <p className="eyebrow">Evidence-backed knowledge</p>
          <h1>主张库</h1>
          <p>按状态和关键词回看可证伪主张。结论展示的是当前证据判断，不是永久真理。</p>
        </div>
        <Scale size={32} />
      </header>

      <form className="claims-filter" method="get">
        <label><Search size={15} /><input aria-label="搜索主张" defaultValue={query} maxLength={100} name="q" placeholder="搜索主张、来源原文或记录标题" /></label>
        <label><Filter size={15} /><select aria-label="主张状态" defaultValue={status ?? ""} name="status"><option value="">全部状态</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <button className="button button-dark" type="submit">筛选</button>
        {query || status ? <Link className="button button-quiet" href="/claims">清除</Link> : null}
      </form>

      <section className="content-section claims-section">
        <div className="section-title"><div><p className="eyebrow">Claim index</p><h2>结构化主张</h2></div><span>{items.length} 条</span></div>
        {items.length ? (
          <div className="claims-index-list">
            {items.map((item) => (
              <Link className={`claim-index-card is-${item.status}`} href={`/captures/${item.captureId}#claims`} key={item.id}>
                <header><span>{statusLabels[item.status]}{item.publishedReleaseCount ? ` · 可靠发布 v${item.publishedReleaseCount}` : ""}</span><small>{item.acceptedEvidenceCount} 条已采纳证据</small></header>
                <h3>{item.statement}</h3>
                <blockquote>原文：“{item.sourceExcerpt}”</blockquote>
                <p><strong>证伪条件</strong>{item.falsificationCriteria}</p>
                {item.latestAssessment ? <div className={`claim-index-assessment is-${item.latestAssessment.assessment}`}><b>{assessmentLabels[item.latestAssessment.assessment]} · v{item.latestAssessment.reviewNumber}</b><span>{item.latestAssessment.rationale}</span></div> : null}
                <footer><span>来源记录：{item.captureTitle || "未命名记录"}</span><ArrowUpRight size={16} /></footer>
              </Link>
            ))}
          </div>
        ) : (
          <div className="empty-state"><span>00</span><h3>没有匹配的主张</h3><p>可以调整筛选条件，或先在记录详情中从 AI 建议创建候选主张。</p></div>
        )}
      </section>
    </div>
  );
}
