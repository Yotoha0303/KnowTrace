import Link from "next/link";
import { Archive, BookMarked, Inbox, Scale, Settings2 } from "lucide-react";

import type { CategoryDTO } from "@/features/capture/queries";
import { CategoryCreator } from "@/components/category-creator";

export function AppShell({
  categories,
  children,
}: Readonly<{
  categories: CategoryDTO[];
  children: React.ReactNode;
}>) {
  return (
    <div className="app-frame">
      <aside className="sidebar">
        <Link className="brand" href="/" aria-label="KnowTrace 首页">
          <span className="brand-mark">K</span>
          <span>
            <strong>KnowTrace</strong>
            <small>Capture what matters</small>
          </span>
        </Link>

        <nav className="nav-list" aria-label="主要导航">
          <Link href="/">
            <Inbox size={17} /> 收集箱
          </Link>
          <Link href="/archived">
            <Archive size={17} /> 已归档
          </Link>
          <Link href="/claims">
            <Scale size={17} /> 主张库
          </Link>
        </nav>

        <section className="sidebar-section">
          <div className="sidebar-heading">
            <span>分类</span>
            <Link aria-label="管理分类" href="/categories"><Settings2 size={15} /></Link>
          </div>
          <div className="category-nav">
            {categories.length === 0 ? (
              <p className="sidebar-empty">还没有分类</p>
            ) : (
              categories.map((category) => (
                <Link href={`/categories/${category.id}`} key={category.id}>
                  <span>{category.name}</span>
                  <small>{category.captureCount}</small>
                </Link>
              ))
            )}
          </div>
          <CategoryCreator />
        </section>

        <div className="sidebar-note">
          <BookMarked size={16} />
          <p>AI 只提出候选。可复用结论必须经过来源检查、证据采纳和人工判断。</p>
        </div>
      </aside>
      <main className="main-content">{children}</main>
    </div>
  );
}
