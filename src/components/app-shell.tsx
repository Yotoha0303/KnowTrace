import Link from "next/link";
import { BookMarked, Settings2, UserRound } from "lucide-react";

import type { CategoryDTO } from "@/features/capture/queries";
import type { WorkspaceAccess } from "@/features/workspace/service";
import { CategoryCreator } from "@/components/category-creator";
import { LogoutButton } from "@/components/logout-button";
import { MobileNavDrawer } from "@/components/mobile-nav-drawer";
import { WorkspaceSwitcher } from "@/components/workspace-switcher";
import { SidebarNav } from "@/components/sidebar-nav";

export function AppShell({
  categories,
  currentWorkspaceId,
  workspaces,
  user,
  children,
}: Readonly<{
  categories: CategoryDTO[];
  currentWorkspaceId: string;
  workspaces: WorkspaceAccess[];
  user: null | { id: number; username: string; nickname: string };
  children: React.ReactNode;
}>) {
  return (
    <div className="app-frame">
      <aside className="sidebar">
        <MobileNavDrawer
          currentWorkspaceId={currentWorkspaceId}
          user={user}
          workspaces={workspaces}
        />

        <Link className="brand" href="/" aria-label="KnowTrace-Workflow 首页">
          <span className="brand-mark">K</span>
          <span>
            <strong>KnowTrace-Workflow</strong>
            <small>Capture what matters</small>
          </span>
        </Link>

        <WorkspaceSwitcher
          currentWorkspaceId={currentWorkspaceId}
          workspaces={workspaces}
        />

        {/* 导航抽成客户端组件，为了给出 pending 态。
            这里仍是服务端组件，其余内容不受影响。 */}
        <SidebarNav />

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
                  <small aria-label={`${category.name}使用中记录数`}>
                    {category.activeCaptureCount}
                  </small>
                </Link>
              ))
            )}
          </div>
          <CategoryCreator />
        </section>

        <div className="sidebar-note">
          <BookMarked size={16} />
          <p>AI 候选需来源检查与人工判断</p>
        </div>
        {user ? (
          <div className="sidebar-user">
            <Link className="sidebar-user-link" href="/account">
              <UserRound size={14} />
              <span>{user.nickname || user.username}</span>
              <small>@{user.username} · 账户中心</small>
            </Link>
            <LogoutButton />
          </div>
        ) : null}
      </aside>
      <main className="main-content">{children}</main>
    </div>
  );
}
