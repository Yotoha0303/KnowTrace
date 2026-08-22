import type { Metadata } from "next";
import { connection } from "next/server";

import { listCategories } from "@/features/capture/queries";
import { AppShell } from "@/components/app-shell";

import "./globals.css";

export const metadata: Metadata = {
  title: { default: "KnowTrace", template: "%s · KnowTrace" },
  description: "把散碎输入变成可追溯、可审阅的知识记录。",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  await connection();
  const categories = await listCategories();

  return (
    <html lang="zh-CN">
      <body>
        <AppShell categories={categories}>{children}</AppShell>
      </body>
    </html>
  );
}
