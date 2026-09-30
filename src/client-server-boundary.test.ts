import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * 守卫：服务端入口的传递依赖里不允许出现客户端指令。
 *
 * 2026-09-30 生产事故：`src/features/auth/client-mode.ts` 里加了客户端指令，
 * 该文件被 `src/proxy.ts` 导入。Next 把这些导出标记为 client reference，
 * 服务端一调用就抛：
 *
 *   Attempted to call isNativeClientRequest() from the server but
 *   isNativeClientRequest is on the client
 *
 * proxy 匹配所有非静态请求，于是**全站 500**（`/api/health/*`、`/api/metrics`、
 * `/login`、`/` 全部 500），全部 `knowtrace_*` 业务指标消失。
 *
 * 为什么原有门禁全都没拦住：`tsc`、ESLint、`vitest`、`pnpm build` 全部通过。
 * 客户端指令是**运行时边界**，构建期不校验导出是否被服务端调用。
 * 这个守卫把该边界变成构建期可判定的静态事实。
 *
 * 另一个坑：判定必须按**文件内容**而不是「行首指令」——同一事故里第一次修复
 * 只删了真指令、注释里仍留着那个字面量，Next 的编译期指令检测照样把它当成真指令，
 * 所以没有修好。这里的判据与 Next 保持一致：只要出现该字面量就算。
 */

const projectRoot = path.resolve(fileURLToPath(new URL("../", import.meta.url)));

/** 服务端入口：proxy 与 Next 的启动钩子。Route Handler 由 proxy 覆盖不到，单列。 */
const SERVER_ENTRIES = ["src/proxy.ts", "src/instrumentation.ts"];

/** 与 Next 的编译期指令检测一致：出现该字面量即视为带指令，注释里也算。 */
const HAS_CLIENT_DIRECTIVE = /use client/;

const IMPORT_PATTERN =
  /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s*["']([^"']+)["']|(?:^|\n)\s*import\s*["']([^"']+)["']/g;

/**
 * 动态导入同样会构成运行时依赖，必须跟随。
 * 案例：`instrumentation.ts` 用 `await import("@/server/metrics")` 加载指标运行时；
 * 只匹配静态 import 会漏掉这一支，守卫覆盖面凭空缩小。
 */
const DYNAMIC_IMPORT_PATTERN = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;

function resolveSpecifier(specifier: string, fromFile: string): string | null {
  let base: string;
  if (specifier.startsWith("@/")) {
    base = path.join(projectRoot, "src", specifier.slice(2));
  } else if (specifier.startsWith(".")) {
    base = path.resolve(path.dirname(fromFile), specifier);
  } else {
    return null; // 第三方包不在本次判定范围
  }
  for (const candidate of [
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
  ]) {
    try {
      readFileSync(candidate);
      return candidate;
    } catch {
      // 继续尝试下一个后缀
    }
  }
  return null;
}

function walkSourceFiles(directory: string, output: string[] = []): string[] {
  for (const name of readdirSync(directory)) {
    const full = path.join(directory, name);
    if (statSync(full).isDirectory()) {
      walkSourceFiles(full, output);
    } else if (full.endsWith(".ts") || full.endsWith(".tsx")) {
      output.push(full);
    }
  }
  return output;
}

function clientDirectiveFiles(): Set<string> {
  const found = new Set<string>();
  for (const file of walkSourceFiles(path.join(projectRoot, "src"))) {
    if (HAS_CLIENT_DIRECTIVE.test(readFileSync(file, "utf8"))) found.add(file);
  }
  return found;
}

/** 从服务端入口做 BFS，收集全部传递依赖。 */
function serverReachableFiles(): Set<string> {
  const reachable = new Set<string>();
  const queue = SERVER_ENTRIES.map((entry) => path.join(projectRoot, entry));

  while (queue.length) {
    const current = queue.pop()!;
    if (reachable.has(current)) continue;
    let content: string;
    try {
      content = readFileSync(current, "utf8");
    } catch {
      continue;
    }
    reachable.add(current);
    const specifiers = [
      ...[...content.matchAll(IMPORT_PATTERN)].map((m) => m[1] ?? m[2]),
      ...[...content.matchAll(DYNAMIC_IMPORT_PATTERN)].map((m) => m[1]),
    ];
    for (const specifier of specifiers) {
      if (!specifier) continue;
      const resolved = resolveSpecifier(specifier, current);
      if (resolved && !reachable.has(resolved)) queue.push(resolved);
    }
  }
  return reachable;
}

describe("client/server 边界", () => {
  it("服务端入口的传递依赖里没有客户端指令", () => {
    const clientFiles = clientDirectiveFiles();
    const serverFiles = serverReachableFiles();
    const violations = [...clientFiles].filter((file) => serverFiles.has(file));

    expect(
      violations.map((file) => path.relative(projectRoot, file)),
      "这些模块带客户端指令，却被 proxy/instrumentation 传递引用；服务端调用会抛 " +
        "「Attempted to call ... from the server」。客户端指令是运行时边界，" +
        "构建期不报错——必须在这里拦住。",
    ).toEqual([]);
  });

  it("守卫自身有效：确实扫到了服务端入口的依赖", () => {
    // 防止 IMPORT_PATTERN 或路径解析失效导致守卫静默通过。
    const serverFiles = serverReachableFiles();
    expect(serverFiles.size).toBeGreaterThan(5);
    expect(serverFiles.has(path.join(projectRoot, "src/proxy.ts"))).toBe(true);
    expect(
      serverFiles.has(path.join(projectRoot, "src/features/auth/client-mode.ts")),
    ).toBe(true);
  });

  it("守卫自身有效：确实能识别出客户端指令", () => {
    const clientFiles = clientDirectiveFiles();
    // 项目里有十几个客户端组件；数量过少说明判定表达式失效了。
    expect(clientFiles.size).toBeGreaterThan(3);
  });
});
