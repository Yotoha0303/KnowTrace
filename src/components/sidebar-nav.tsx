"use client";

import Link from "next/link";
import { useLinkStatus } from "next/link";
import { Archive, ArrowLeftRight, ContactRound, Inbox, Scale, Search } from "lucide-react";

/**
 * 侧边栏主导航 —— 客户端组件，唯一目的是给出**导航 pending 态**。
 *
 * 为什么只有这个文件是客户端组件：`useLinkStatus` 必须在客户端使用，
 * 但它只对**发起导航的那个 Link**有意义（见下方注释）。
 * 整个 `app-shell.tsx` 保持服务端组件，只把这一块抽出来，
 * 避免为了一个 pending 态把大量服务端渲染搬到客户端。
 *
 * 背景：14 个页面里 10 个 `force-dynamic`，导航要一次完整的服务端往返
 * （实测 0.06–0.33s）。原先点击后**没有任何反馈**，看起来像卡住，
 * 会诱导用户重复点击。见 docs/changes/2026-10-01-导航加载态.md。
 */

const NAV_ITEMS = [
  { href: "/", label: "收集箱", Icon: Inbox },
  { href: "/archived", label: "已归档", Icon: Archive },
  { href: "/claims", label: "主张库", Icon: Scale },
  { href: "/search", label: "知识检索", Icon: Search },
  { href: "/subjects", label: "对象时间线", Icon: ContactRound },
  { href: "/data-transfer", label: "数据迁移", Icon: ArrowLeftRight },
] as const;

/**
 * ⚠️ `useLinkStatus` 读取的是**最近的 Link 祖先**的 pending 状态。
 * 所以它必须在 Link 的**子组件**里调用 —— 在同一个组件里调用会拿到
 * 自己这一层的上下文，而不是那个 Link 的。这是它最容易用错的地方，
 * 所以单独抽成一个只负责渲染内容的子组件。
 */
function NavItemContent({ label, Icon }: { label: string; Icon: typeof Inbox }) {
  const { pending } = useLinkStatus();
  return (
    <span className="nav-item" data-pending={pending ? "true" : undefined}>
      <Icon size={17} /> {label}
      {pending ? <span className="nav-pending-dot" aria-hidden="true" /> : null}
    </span>
  );
}

export function SidebarNav() {
  return (
    <nav className="nav-list" aria-label="主要导航">
      {NAV_ITEMS.map(({ href, label, Icon }) => (
        <Link href={href} key={href}>
          <NavItemContent label={label} Icon={Icon} />
        </Link>
      ))}
    </nav>
  );
}
