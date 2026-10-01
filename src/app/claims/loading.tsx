/**
 * 导航加载态（/claims）—— 这一页是**纵向列表**，不是卡片网格，
 * 所以单独定义，避免内容到达时布局跳变。
 *
 * 视觉上只有色块，不出现任何像真实数据的文字（见 docs/changes/2026-10-01-导航加载态.md）。
 */
export default function Loading() {
  return (
    <div className="page-shell">
      <header className="collection-header">
        <div>
          <div className="skeleton-block skeleton-eyebrow" />
          <div className="skeleton-block skeleton-title" />
        </div>
      </header>

      <section className="content-section" style={{ marginTop: 0 }}>
        {[0, 1, 2, 3, 4].map((index) => (
          <div className="skeleton-row" key={index}>
            <div className="skeleton-block skeleton-line" style={{ width: `${70 - index * 6}%` }} />
            <div className="skeleton-block skeleton-line is-short" />
          </div>
        ))}
      </section>

      <p className="sr-only" role="status">正在加载主张库…</p>
    </div>
  );
}
