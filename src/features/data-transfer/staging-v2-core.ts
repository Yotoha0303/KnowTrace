import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { AppError } from "@/shared/errors/app-error";

import { PORTABLE_PACKAGE_V2_MAX_COMPRESSED_BYTES } from "./package-v2";

const IMPORT_RUN_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function stagingRoot(): string {
  return path.resolve(
    /* turbopackIgnore: true */
    process.env.DATA_IMPORT_STAGING_DIR ??
      path.join(process.cwd(), "data", "import-staging"),
  );
}

function resolveStagedPackagePath(runId: string): string {
  if (!IMPORT_RUN_ID_PATTERN.test(runId)) {
    throw new AppError("IMPORT_RUN_ID_INVALID", "导入预检标识无效。");
  }
  const root = stagingRoot();
  const resolved = path.resolve(root, `${runId}.zip`);
  if (path.dirname(resolved) !== root) {
    throw new AppError("IMPORT_STAGING_PATH_INVALID", "导入暂存路径无效。");
  }
  return resolved;
}

export async function writePortablePackageV2Staging(
  runId: string,
  bytes: Uint8Array,
): Promise<void> {
  if (bytes.byteLength < 1 || bytes.byteLength > PORTABLE_PACKAGE_V2_MAX_COMPRESSED_BYTES) {
    throw new AppError(
      "IMPORT_PACKAGE_SIZE_INVALID",
      "v2 交换包必须大于 0 B，且压缩后不能超过 256 MiB。",
    );
  }

  const root = stagingRoot();
  await mkdir(root, { recursive: true });
  const target = resolveStagedPackagePath(runId);
  const temporary = `${target}.${randomUUID()}.tmp`;
  await writeFile(temporary, bytes, { flag: "wx" });
  try {
    await rename(temporary, target);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

export async function readPortablePackageV2Staging(runId: string): Promise<Buffer> {
  try {
    const bytes = await readFile(
      /* turbopackIgnore: true */ resolveStagedPackagePath(runId),
    );
    if (
      bytes.byteLength < 1 ||
      bytes.byteLength > PORTABLE_PACKAGE_V2_MAX_COMPRESSED_BYTES
    ) {
      throw new AppError(
        "IMPORT_STAGED_PACKAGE_SIZE_INVALID",
        "暂存的 v2 交换包大小无效，请重新上传预检。",
      );
    }
    return bytes;
  } catch (error) {
    if (error instanceof AppError) throw error;
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new AppError(
        "IMPORT_STAGED_PACKAGE_MISSING",
        "导入暂存文件已不存在，请重新上传预检。",
      );
    }
    throw new AppError(
      "IMPORT_STAGED_PACKAGE_UNREADABLE",
      "导入暂存文件无法读取，请重新上传预检。",
      { cause: error instanceof Error ? error.message : String(error) },
    );
  }
}

export async function removePortablePackageV2Staging(runId: string): Promise<void> {
  await unlink(resolveStagedPackagePath(runId)).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
}
