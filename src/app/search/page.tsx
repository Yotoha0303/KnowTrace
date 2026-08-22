import Link from "next/link";
import {
  ArrowUpRight,
  BookOpenText,
  FileText,
  FolderSearch,
  LibraryBig,
  Scale,
  Search,
  ShieldCheck,
  UserRoundSearch,
} from "lucide-react";

import { listCategories } from "@/features/capture/queries";
import type { KnowledgeSearchItem, SearchEntityType } from "@/features/search/queries";
import { searchKnowledge } from "@/features/search/queries";
import {
  normalizeDateFilter,
  normalizeSearchQuery,
  normalizeSubjectFilter,
  occurredAtBounds,
} from "@/features/search/utils";

export const dynamic = "force-dynamic";

const typeLabels: Record<SearchEntityType, string> = {
  all: "全部知识对象",
  capture: "原始记录",
  claim: "可证伪主张",
  evidence: "证据材料",
  conclusion: "审核结论",
};

const allowedTypes = new Set<SearchEntityType>([
  "all",
  "capture",
  "claim",
  "evidence",
  "conclusion",
]);

const occurredDateFormatter = new Intl.DateTimeFormat("zh-CN", {
  dateStyle: "medium",
  timeZone: "Asia/Shanghai",
});

const groupDefinitions = [
  { key: "captures", label: "原始记录", eyebrow: "Capture", icon: FileText },
  { key: "claims", label: "可证伪主张", eyebrow: "Claim", icon: Scale },
  { key: "evidence", label: "证据材料", eyebrow: "Evidence", icon: ShieldCheck },
  { key: "conclusions", label: "审核结论", eyebrow: "Conclusion", icon: BookOpenText },
] as const;

const statusLabels: Record<string, string> = {
  active: "活跃",
  archived: "已归档",
  candidate: "候选",
  investigating: "调查中",
  ready_for_review: "待审核",
  concluded: "已形成结论",
  withdrawn: "已撤回",
};

function resultHref(item: KnowledgeSearchItem) {
  return item.type === "capture" ? `/captures/${item.captureId}` : `/captures/${item.captureId}#claims`;
}

function statusLabel(status: string) {
  const [assessment, review, match] = status.split("/");
  if (review?.startsWith("v")) {
    const assessmentLabels: Record<string, string> = {
      supported: "现有证据支持",
      refuted: "现有证据反驳",
      inconclusive: "证据不足",
    };
    return `${assessmentLabels[assessment] ?? assessment} · ${review}`;
  }
  if (match) {
    const reviewLabels: Record<string, string> = {
      unreviewed: "未审核",
      accepted: "已采纳",
      rejected: "已排除",
    };
    const sourceLabels: Record<string, string> = {
      unchecked: "来源未检查",
      passed: "来源可访问",
      failed: "来源检查失败",
    };
    const matchLabels: Record<string, string> = {
      matched: "摘录匹配",
      mismatched: "摘录不匹配",
      unknown: "摘录未判断",
    };
    return `${reviewLabels[assessment] ?? assessment} / ${sourceLabels[review] ?? review} / ${matchLabels[match] ?? match}`;
  }
  return statusLabels[status] ?? status;
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    type?: string;
    category?: string;
    subject?: string;
    from?: string;
    to?: string;
  }>;
}) {
  const params = await searchParams;
  const query = normalizeSearchQuery(params.q);
  const subject = normalizeSubjectFilter(params.subject);
  const from = normalizeDateFilter(params.from);
  const to = normalizeDateFilter(params.to);
  const { start, endExclusive } = occurredAtBounds(from, to);
  const invalidDateRange = Boolean(start && endExclusive && start >= endExclusive);
  const type = allowedTypes.has(params.type as SearchEntityType)
    ? (params.type as SearchEntityType)
    : "all";
  const categories = await listCategories();
  const categoryId = categories.some((category) => category.id === params.category)
    ? params.category
    : undefined;
  const result = invalidDateRange
    ? { query, groups: { captures: [], claims: [], evidence: [], conclusions: [] }, returnedCount: 0 }
    : await searchKnowledge({
        query,
        type,
        categoryId,
        subject,
        occurredFrom: start,
        occurredToExclusive: endExclusive,
        limitPerType: 20,
      });
  const hasCriteria = Boolean(query || subject || from || to);
  const resultDescription = [
    query ? `全文“${query}”` : "",
    subject ? `对象“${subject}”` : "",
    from ? `从 ${from}` : "",
    to ? `至 ${to}` : "",
  ].filter(Boolean).join(" · ");

  return (
    <div className="page-shell search-page">
      <header className="collection-header">
        <div>
          <p className="eyebrow">Unified knowledge retrieval</p>
          <h1>知识检索</h1>
          <p>同时检索原始记录、可证伪主张、证据和人工结论，并始终回到它们的来源记录。</p>
        </div>
        <LibraryBig size={32} />
      </header>

      <form className="knowledge-search-form" method="get">
        <label className="knowledge-search-input">
          <Search size={17} />
          <input
            aria-label="检索知识库"
            autoFocus
            defaultValue={query}
            maxLength={100}
            name="q"
            placeholder="输入关键词、对象、事件、主张或来源摘录"
          />
        </label>
        <label>
          <span>对象</span>
          <select aria-label="知识对象类型" defaultValue={type} name="type">
            {Object.entries(typeLabels).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        <label>
          <span>分类</span>
          <select aria-label="知识分类" defaultValue={categoryId ?? ""} name="category">
            <option value="">全部分类</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>{category.name}</option>
            ))}
          </select>
        </label>
        <button className="button button-dark" type="submit">检索</button>
        {hasCriteria || categoryId || type !== "all" ? <Link className="button button-quiet" href="/search">清除</Link> : null}
        <div className="knowledge-search-metadata">
          <label>
            <span><UserRoundSearch size={13} /> 描述对象</span>
            <input
              aria-label="按描述对象筛选"
              defaultValue={subject}
              maxLength={200}
              name="subject"
              placeholder="公司、人物、项目，可部分匹配"
            />
          </label>
          <label>
            <span>发生时间从</span>
            <input aria-label="发生时间开始日期" defaultValue={from} name="from" type="date" />
          </label>
          <label>
            <span>发生时间至</span>
            <input aria-label="发生时间结束日期" defaultValue={to} name="to" type="date" />
          </label>
        </div>
      </form>

      {invalidDateRange ? (
        <div className="search-filter-error">发生时间的开始日期不能晚于结束日期。</div>
      ) : !hasCriteria ? (
        <section className="search-entry-state">
          <FolderSearch size={38} />
          <div>
            <h2>从一段记忆线索开始</h2>
            <p>无需知道内容当时保存在哪里。结果会区分未经审核的原始材料与已有证据边界的人工结论。</p>
          </div>
          <div className="search-scope-grid">
            {groupDefinitions.map(({ key, label, icon: Icon }) => (
              <article key={key}><Icon size={17} /><strong>{label}</strong><span>{key === "captures" ? "保留原始上下文" : key === "claims" ? "定位可检验陈述" : key === "evidence" ? "回看来源与摘录" : "回看当时证据判断"}</span></article>
            ))}
          </div>
        </section>
      ) : result.returnedCount === 0 ? (
        <div className="empty-state search-empty"><span>00</span><h3>没有找到相关知识</h3><p>尝试减少关键词、切换知识对象，或清除分类限制。</p></div>
      ) : (
        <div className="search-results">
          <div className="search-result-summary">
            <strong>{resultDescription}</strong>
            <span>返回 {result.returnedCount} 条结果；每类最多显示 20 条</span>
          </div>
          {groupDefinitions.map(({ key, label, eyebrow, icon: Icon }) => {
            const items = result.groups[key];
            if (!items.length) return null;
            return (
              <section className="search-result-group" key={key}>
                <div className="section-title">
                  <div><p className="eyebrow">{eyebrow}</p><h2><Icon size={21} /> {label}</h2></div>
                  <span>{items.length} 条</span>
                </div>
                <div className="search-result-list">
                  {items.map((item) => (
                    <Link className={`search-result-card is-${item.type}`} href={resultHref(item)} key={`${item.type}-${item.id}`}>
                      <header>
                        <span>{statusLabel(item.status)}</span>
                        <time dateTime={item.occurredAt}>{occurredDateFormatter.format(new Date(item.occurredAt))}</time>
                      </header>
                      <h3>{item.title}</h3>
                      <p>{item.excerpt}</p>
                      <footer>
                        <div>
                          {item.type !== "capture" ? <small>来源：{item.captureTitle || "未命名记录"}</small> : null}
                          {item.subject ? <span className="subject-tag"><UserRoundSearch size={11} />{item.subject}</span> : null}
                          {item.categories.map((category) => <span className="tag" key={category.id}>{category.name}</span>)}
                        </div>
                        <ArrowUpRight size={16} />
                      </footer>
                    </Link>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
