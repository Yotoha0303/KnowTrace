"use client";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="center-state">
      <p className="eyebrow">Something went wrong</p>
      <h1>暂时无法读取知识库</h1>
      <p>请确认数据库已经启动，然后重试。</p>
      <button className="button button-primary" onClick={reset} type="button">重新加载</button>
    </div>
  );
}
