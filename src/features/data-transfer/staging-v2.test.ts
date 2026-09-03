import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  readPortablePackageV2Staging,
  removePortablePackageV2Staging,
  writePortablePackageV2Staging,
} from "./staging-v2-core";

let root = "";
const previousStagingDir = process.env.DATA_IMPORT_STAGING_DIR;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "knowtrace-import-stage-"));
  process.env.DATA_IMPORT_STAGING_DIR = root;
});

afterEach(async () => {
  if (previousStagingDir === undefined) delete process.env.DATA_IMPORT_STAGING_DIR;
  else process.env.DATA_IMPORT_STAGING_DIR = previousStagingDir;
  if (root) await rm(root, { recursive: true, force: true });
});

describe("v2 import staging", () => {
  it("writes, reads and removes a staged package by import run id", async () => {
    const runId = randomUUID();
    const bytes = Buffer.from("PK\u0003\u0004-test-package", "binary");

    await writePortablePackageV2Staging(runId, bytes);
    await expect(readPortablePackageV2Staging(runId)).resolves.toEqual(bytes);

    await removePortablePackageV2Staging(runId);
    await expect(readPortablePackageV2Staging(runId)).rejects.toMatchObject({
      code: "IMPORT_STAGED_PACKAGE_MISSING",
    });
  });

  it("rejects a non-UUID run id before resolving a staging path", async () => {
    await expect(
      writePortablePackageV2Staging("../escape", Buffer.from("x")),
    ).rejects.toMatchObject({ code: "IMPORT_RUN_ID_INVALID" });
    await expect(readPortablePackageV2Staging("C:/escape")).rejects.toMatchObject({
      code: "IMPORT_RUN_ID_INVALID",
    });
  });
});
