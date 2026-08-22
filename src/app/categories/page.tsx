import Link from "next/link";
import { ArrowLeft, Settings2 } from "lucide-react";

import { CategoryCreator } from "@/components/category-creator";
import { CategoryManager } from "@/components/category-manager";
import { listCategories } from "@/features/capture/queries";

export const dynamic = "force-dynamic";

export default async function CategoriesPage() {
  const categories = await listCategories(true);
  return (
    <div className="page-shell">
      <header className="collection-header">
        <div>
          <Link className="back-link" href="/"><ArrowLeft size={16} /> 返回收集箱</Link>
          <p className="eyebrow">Taxonomy</p>
          <h1>分类管理</h1>
          <p>分类可以重命名、归档和恢复。归档不会移除记录上的历史关联。</p>
        </div>
        <Settings2 size={32} />
      </header>
      <div className="category-create-card">
        <h2>新建分类</h2>
        <CategoryCreator />
      </div>
      {categories.length ? <CategoryManager categories={categories} /> : <div className="empty-state"><span>00</span><h3>还没有分类</h3><p>创建第一个分类，为散碎输入建立最小秩序。</p></div>}
    </div>
  );
}
