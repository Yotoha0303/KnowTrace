import { describe, expect, it } from "vitest";

import { prepareEvidenceImage } from "./image-validation";

describe("evidence image storage validation", () => {
  it("uses the detected image format and creates a hash", async () => {
    const file = new File(
      [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
      "screen.png",
      { type: "image/png" },
    );
    const prepared = await prepareEvidenceImage(file);
    expect(prepared.mimeType).toBe("image/png");
    expect(prepared.storagePath).toMatch(/^[0-9a-f-]+\.png$/);
    expect(prepared.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects a forged MIME declaration", async () => {
    const file = new File(["plain text"], "fake.png", { type: "image/png" });
    await expect(prepareEvidenceImage(file)).rejects.toMatchObject({
      code: "EVIDENCE_IMAGE_TYPE_INVALID",
    });
  });
});
