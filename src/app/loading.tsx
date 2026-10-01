/**
 * 导航加载态（根级）—— 覆盖所有未单独定义 loading 的页面。
 *
 * 为什么需要：14 个页面里 10 个是 `force-dynamic`，每次导航都要一次完整的
 * 服务端往返（实测 0.06–0.33s）。而项目原先**没有任何 `loading.tsx`**，
 * 于是那段往返对用户是**完全不可见的空白** —— 点击后界面纹丝不动，
 * 看起来像卡住了。见 docs/changes/2026-10-01-导航加载态.md。
 *
 * 设计约束（三条，来自该记录第 4 节）：
 *   1. **只做形状，不做内容** —— 不出现任何像真实数据的文字。
 *      否则用户可能把骨架误读成「加载完了，但是空的」。
 *   2. **位置贴近真实布局** —— 复用 `page-shell` / `page-header` /
 *      `content-section` / `capture-grid`，内容到达时不明显跳变。
 *   3. 动效尊重 `prefers-reduced-motion`（见 globals.css）。
 *
 * 注意：这里**不改变任何数据新鲜度**。`force-dynamic` 保持原样——
 * 换缓存策略是另一个课题，有数据陈旧风险，不该混进这次改动。
 */
export default function Loading() {
  return (
    <div className="page-shell">
      <header className="page-header">
        <div>
          <div className="skeleton-block skeleton-eyebrow" />
          <div className="skeleton-block skeleton-title" />
          <div className="skeleton-block skeleton-line" style={{ width: "min(520px, 88%)" }} />
        </div>
      </header>

      <section className="content-section" style={{ marginTop: 0 }}>
        <div className="section-title">
          <div className="skeleton-block skeleton-eyebrow" style={{ marginBottom: 0 }} />
        </div>
        <div className="capture-grid">
          {[0, 1, 2, 3].map((index) => (
            <div className="capture-card skeleton-card" key={index}>
              <div className="skeleton-block skeleton-card-meta" />
              <div className="skeleton-block skeleton-card-title" />
              <div className="skeleton-block skeleton-line" />
              <div className="skeleton-block skeleton-line" />
              <div className="skeleton-block skeleton-line is-short" />
            </div>
          ))}
        </div>
      </section>

      {/* 屏幕阅读器可感知：视觉上是骨架，语义上要说明"正在加载" */}
      <p className="sr-only" role="status">正在加载页面内容…</p>
    </div>
  );
}
