import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowUpRight, CalendarRange, Scale, ShieldCheck } from "lucide-react";

import { getSubjectTimeline } from "@/features/subjects/queries";
import { CONTENT_TYPE_LABELS } from "@/features/capture/schema";

export const dynamic = "force-dynamic";

const formatDateTime = (value: string) =>
  new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Shanghai",
  }).format(new Date(value));

const assessmentLabel = {
  supported: "现有证据支持",
  refuted: "现有证据反驳",
  inconclusive: "证据不足",
} as const;

export default async function SubjectTimelinePage({ params }: { params: Promise<{ subject: string }> }) {
  const { subject } = await params;
  const timeline = await getSubjectTimeline(subject);
  if (!timeline) notFound();

  return (
    <div className="page-shell subject-timeline-page">
      <header className="collection-header">
        <div>
          <Link className="back-link" href="/subjects"><ArrowLeft size={16} /> 返回对象目录</Link>
          <p className="eyebrow">Object timeline</p>
          <h1>{timeline.subject}</h1>
          <p>按记录中的“发生时间”排列，共 {timeline.captures.length} 个时间点。人工结论显示其审核时间，不能反推为事件发生时间。</p>
        </div>
        <CalendarRange size={32} />
      </header>

      <section className="subject-timeline" aria-label={`${timeline.subject}时间线`}>
        {timeline.captures.map((capture) => (
          <article className="subject-timeline-event" key={capture.id}>
            <time dateTime={capture.occurredAt}>{formatDateTime(capture.occurredAt)}</time>
            <div className="subject-timeline-card">
              <header>
                <span>{CONTENT_TYPE_LABELS[capture.contentType]}</span>
                <small>记录于 {formatDateTime(capture.createdAt)}</small>
              </header>
              <h2>{capture.title || "未命名记录"}</h2>
              <p>{capture.content}</p>
              {capture.categories.length ? <div className="tag-row">{capture.categories.map((category) => <Link className="tag" href={`/categories/${category.id}`} key={category.id}>{category.name}</Link>)}</div> : null}
              {capture.claims.length ? (
                <div className="subject-event-claims">
                  <strong><Scale size={14} /> 结构化主张</strong>
                  {capture.claims.map((claim) => (
                    <div key={claim.id}>
                      <p>{claim.statement}</p>
                      {claim.latestAssessment ? (
                        <aside className={`is-${claim.latestAssessment.assessment}`}>
                          <b><ShieldCheck size={12} />{assessmentLabel[claim.latestAssessment.assessment]}</b>
                          <span>{claim.latestAssessment.rationale}</span>
                          <small>审核 v{claim.latestAssessment.reviewNumber} · {formatDateTime(claim.latestAssessment.createdAt)}</small>
                        </aside>
                      ) : <small>状态：{claim.status}，尚无人工结论</small>}
                    </div>
                  ))}
                </div>
              ) : null}
              <Link className="subject-event-link" href={`/captures/${capture.id}`}>查看原始记录与证据链 <ArrowUpRight size={14} /></Link>
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}
