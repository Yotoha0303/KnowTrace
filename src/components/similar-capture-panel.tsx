import Link from "next/link";
import {
  ArrowUpRight,
  CalendarDays,
  Contact,
  Network,
} from "lucide-react";

import type { SimilarCaptureDTO } from "@/features/similarity/queries";

const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "short",
  day: "numeric",
  timeZone: "Asia/Shanghai",
});

export function SimilarCapturePanel({
  items,
}: {
  items: SimilarCaptureDTO[];
}) {
  return (
    <section aria-labelledby="similar-captures-title" className="similar-captures-panel">
      <div className="similar-captures-heading">
        <div>
          <p className="eyebrow">Related memory cues</p>
          <h2 id="similar-captures-title"><Network size={21} /> 相似记录</h2>
        </div>
        <span>{items.length} 条线索</span>
      </div>
      <p className="similar-captures-boundary">
        按描述对象、共同分类和文字片段计算，只帮助回看旧记录；相似不代表观点一致、内容真实或已经验证。
      </p>
      {items.length ? (
        <div className="similar-capture-list">
          {items.map((item) => {
            const excerpt = item.content.length > 150
              ? `${item.content.slice(0, 147).trim()}…`
              : item.content;
            return (
              <Link className="similar-capture-card" href={`/captures/${item.id}`} key={item.id}>
                <header>
                  <span>{item.status === "archived" ? "已归档" : "使用中"}</span>
                  <time dateTime={item.occurredAt}>
                    <CalendarDays size={12} />
                    {dateFormatter.format(new Date(item.occurredAt))}
                  </time>
                </header>
                <h3>{item.title || "未命名记录"}</h3>
                <p>{excerpt}</p>
                <div className="similar-reason-list" aria-label="相似原因">
                  {item.reasons.map((reason) => <span key={reason}>{reason}</span>)}
                </div>
                <footer>
                  <div>
                    {item.subject ? <span><Contact size={11} />{item.subject}</span> : null}
                    {item.categories.slice(0, 2).map((category) => (
                      <span className="tag" key={category.id}>{category.name}</span>
                    ))}
                  </div>
                  <ArrowUpRight size={16} />
                </footer>
              </Link>
            );
          })}
        </div>
      ) : (
        <div className="similar-capture-empty">
          <Network size={22} />
          <div>
            <strong>暂未发现明显相似记录</strong>
            <p>继续积累描述对象、分类和原文后，这里会自动出现可回看的历史线索。</p>
          </div>
        </div>
      )}
    </section>
  );
}
