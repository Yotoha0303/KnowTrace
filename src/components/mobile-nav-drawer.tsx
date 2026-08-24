"use client";

import Link from "next/link";
import { Archive, ArrowLeftRight, ContactRound, Inbox, Menu, Scale, Search, Settings2, UserRound } from "lucide-react";
import { useRef } from "react";

import { LogoutButton } from "@/components/logout-button";

type MobileNavDrawerProps = Readonly<{
  user: null | { id: number; username: string; nickname: string };
}>;

export function MobileNavDrawer({ user }: MobileNavDrawerProps) {
  const drawerRef = useRef<HTMLDetailsElement>(null);

  function closeDrawer() {
    if (drawerRef.current) drawerRef.current.open = false;
  }

  return (
    <details className="mobile-nav-drawer" ref={drawerRef}>
      <summary aria-label="打开主要导航" title="菜单">
        <Menu size={21} />
      </summary>
      <div className="mobile-nav-panel">
        <p className="mobile-nav-heading">导航</p>
        <nav className="mobile-nav-list" aria-label="移动端主要导航">
          <Link href="/" onClick={closeDrawer}>
            <Inbox size={18} /> 收集箱
          </Link>
          <Link href="/archived" onClick={closeDrawer}>
            <Archive size={18} /> 已归档
          </Link>
          <Link href="/claims" onClick={closeDrawer}>
            <Scale size={18} /> 主张库
          </Link>
          <Link href="/search" onClick={closeDrawer}>
            <Search size={18} /> 知识检索
          </Link>
          <Link href="/subjects" onClick={closeDrawer}>
            <ContactRound size={18} /> 对象时间线
          </Link>
          <Link href="/data-transfer" onClick={closeDrawer}>
            <ArrowLeftRight size={18} /> 数据迁移
          </Link>
          <Link href="/categories" onClick={closeDrawer}>
            <Settings2 size={18} /> 分类管理
          </Link>
        </nav>

        {user ? (
          <div className="mobile-nav-account">
            <Link href="/account" onClick={closeDrawer}>
              <UserRound size={18} />
              <span>
                <strong>{user.nickname || user.username}</strong>
                <small>@{user.username} · 账户中心</small>
              </span>
            </Link>
            <LogoutButton />
          </div>
        ) : null}
      </div>
    </details>
  );
}
