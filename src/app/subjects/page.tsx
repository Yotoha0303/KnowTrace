import Link from "next/link";
import { ArrowUpRight, ContactRound, Search } from "lucide-react";

import { listSubjectSummaries } from "@/features/subjects/queries";

export const dynamic = "force-dynamic";

const formatDate = (value: string) =>
  new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeZone: "Asia/Shanghai" }).format(new Date(value));

export default async function SubjectsPage() {
  const subjects = await listSubjectSummaries();

  return (
    <div className="page-shell">
      <header className="page-header">
        <div>
          <p className="eyebrow">Subject index</p>
          <h1>描述对象</h1>
          <p className="page-intro">把分散记录按人物、公司、项目或事件对象聚合。数量和时间仅来自你的记录，不表示这些内容已经核验。</p>
        </div>
        <span className="status-pill"><span />{subjects.length} 个对象</span>
      </header>

      {subjects.length ? (
        <section className="subject-index-grid" aria-label="描述对象列表">
          {subjects.map((subject) => (
            <Link className="subject-index-card" href={`/subjects/${encodeURIComponent(subject.name)}`} key={subject.name.toLocaleLowerCase("zh-CN")}>
              <header><ContactRound size={18} /><strong>{subject.name}</strong><ArrowUpRight size={15} /></header>
              <p>{subject.captureCount} 条记录</p>
              <small>{formatDate(subject.firstOccurredAt)} — {formatDate(subject.lastOccurredAt)}</small>
            </Link>
          ))}
        </section>
      ) : (
        <div className="empty-state"><span>00</span><h3>还没有描述对象</h3><p>记录人物、公司或项目名称后，对象时间线会自动出现。</p></div>
      )}

      <Link className="button button-quiet subject-search-link" href="/search"><Search size={15} /> 使用组合检索</Link>
    </div>
  );
}
