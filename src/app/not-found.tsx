import Link from "next/link";

export default function NotFound() {
  return (
    <div className="center-state">
      <p className="eyebrow">404</p>
      <h1>没有找到这条记录</h1>
      <p>它可能已被删除，或者链接不完整。</p>
      <Link className="button button-primary" href="/">返回收集箱</Link>
    </div>
  );
}
