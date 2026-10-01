import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // `server-only` 在打包期由 Next 标记，import 时直接抛错，单测里换成 no-op。
      "server-only": fileURLToPath(
        new URL("./tests/stubs/server-only.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    // 收 .tsx：组件测试需要 JSX。
    // 环境仍是全局 node，需要 DOM 的文件用 `// @vitest-environment jsdom` 按文件指定——
    // 这样不会影响既有的大量 node 测试。
    include: ["src/**/*.test.{ts,tsx}", "tests/**/*.test.{ts,tsx}"],
    coverage: {
      reporter: ["text", "html"],
    },
  },
});
