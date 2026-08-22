import type { Metadata } from "next";
import { headers } from "next/headers";
import { connection } from "next/server";

import { listCategories } from "@/features/capture/queries";
import { AppShell } from "@/components/app-shell";
import { isAuthEnabled } from "@/features/auth/go-user-system";

import "./globals.css";

export const metadata: Metadata = {
  title: { default: "KnowTrace", template: "%s · KnowTrace" },
  description: "把散碎输入变成可追溯、可审阅的知识记录。",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const requestHeaders = await headers();
  const authEnabled = isAuthEnabled();
  const authPage = requestHeaders.get("x-knowtrace-auth-page") === "1";
  const userId = requestHeaders.get("x-knowtrace-user-id");
  const user = userId
    ? {
        id: Number(userId),
        username: decodeURIComponent(
          requestHeaders.get("x-knowtrace-username") ?? "",
        ),
        nickname: decodeURIComponent(
          requestHeaders.get("x-knowtrace-nickname") ?? "",
        ),
      }
    : null;

  if (authEnabled && (authPage || !user)) {
    return (
      <html lang="zh-CN">
        <body>{children}</body>
      </html>
    );
  }

  await connection();
  const categories = await listCategories();

  return (
    <html lang="zh-CN">
      <body>
        <AppShell categories={categories} user={user}>{children}</AppShell>
      </body>
    </html>
  );
}
