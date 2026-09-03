// @vitest-environment jsdom

import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DataTransferPanel } from "./data-transfer-panel";

const baseSummary = {
  valid: true,
  recordsTotal: 2,
  recordsToCreate: 1,
  recordsToSkip: 1,
  categoriesTotal: 1,
  categoriesToCreate: 0,
  categoriesToReuse: 1,
  relationshipsTotal: 1,
  issues: [],
};

function mockJson(data: unknown) {
  return {
    ok: true,
    json: async () => ({ data }),
  } as Response;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("DataTransferPanel protocol routing", () => {
  it("keeps .xlsx imports on the v1 preview endpoint", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        mockJson({
          runId: "11111111-1111-4111-8111-111111111111",
          status: "previewed",
          summary: baseSummary,
        }),
      );

    render(React.createElement(DataTransferPanel));
    const input = screen.getByLabelText(/KnowTrace 文件/) as HTMLInputElement;
    fireEvent.change(input, {
      target: {
        files: [
          new File(["xlsx"], "knowtrace.xlsx", {
            type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          }),
        ],
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "开始预检" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/data-transfer/import/preview");
    expect(
      await screen.findByRole("heading", { name: "预检结果 · Excel v1" }),
    ).toBeTruthy();
  });

  it("routes .zip imports to v2 and renders the knowledge-chain downgrade plan", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        mockJson({
          runId: "22222222-2222-4222-8222-222222222222",
          status: "previewed",
          summary: {
            valid: true,
            packageIssues: [],
            base: baseSummary,
            knowledge: {
              valid: true,
              claims: { total: 2, toCreate: 1, toSkip: 1, toRepair: 0, conflicts: 0 },
              evidence: { total: 1, toCreate: 1, toSkip: 0, toRepair: 0, conflicts: 0 },
              attachments: { total: 1, toCreate: 1, toSkip: 0, toRepair: 0, conflicts: 0 },
              historicalContext: {
                sourceChecks: 1,
                attachmentChecks: 0,
                reviews: 1,
                reviewEvidenceRelationships: 1,
              },
              downgraded: {
                claimTrustStates: 1,
                claimSourceVersions: 2,
                evidenceVersions: 0,
                evidenceReviewStates: 1,
                evidenceCheckStates: 1,
                reviews: 1,
              },
              issues: [],
            },
            issues: [],
          },
        }),
      );

    render(React.createElement(DataTransferPanel));
    const input = screen.getByLabelText(/KnowTrace 文件/) as HTMLInputElement;
    fireEvent.change(input, {
      target: {
        files: [new File(["PK"], "knowtrace.zip", { type: "application/zip" })],
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "开始预检" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/data-transfer/v2/import/preview");
    expect(await screen.findByText("知识链计划")).toBeTruthy();
    expect(screen.getByText(/历史人工结论 1 项不会直接恢复为可信结论/)).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "确认导入" }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("keeps v1 confirmation on the v1 confirm endpoint", async () => {
    const runId = "33333333-3333-4333-8333-333333333333";
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        mockJson({ runId, status: "previewed", summary: baseSummary }),
      )
      .mockResolvedValueOnce(
        mockJson({
          runId,
          status: "completed",
          result: {
            recordsCreated: 1,
            recordsSkipped: 1,
            categoriesCreated: 0,
            categoriesReused: 1,
            relationshipsCreated: 1,
          },
        }),
      );

    render(React.createElement(DataTransferPanel));
    fireEvent.change(screen.getByLabelText(/KnowTrace 文件/), {
      target: { files: [new File(["xlsx"], "knowtrace.xlsx")] },
    });
    fireEvent.click(screen.getByRole("button", { name: "开始预检" }));
    const confirm = await screen.findByRole("button", { name: "确认导入" });
    fireEvent.click(confirm);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      `/api/data-transfer/import/${runId}/confirm`,
    );
    expect(await screen.findByText(/新增记录 1 条 · 跳过 1 条/)).toBeTruthy();
  });

  it("keeps v2 confirmation on the v2 confirm endpoint and renders object results", async () => {
    const runId = "44444444-4444-4444-8444-444444444444";
    const knowledge = {
      valid: true,
      claims: { total: 1, toCreate: 1, toSkip: 0, toRepair: 0, conflicts: 0 },
      evidence: { total: 1, toCreate: 1, toSkip: 0, toRepair: 0, conflicts: 0 },
      attachments: { total: 1, toCreate: 1, toSkip: 0, toRepair: 0, conflicts: 0 },
      historicalContext: {
        sourceChecks: 1,
        attachmentChecks: 0,
        reviews: 1,
        reviewEvidenceRelationships: 1,
      },
      downgraded: {
        claimTrustStates: 1,
        claimSourceVersions: 1,
        evidenceVersions: 0,
        evidenceReviewStates: 1,
        evidenceCheckStates: 1,
        reviews: 1,
      },
      issues: [],
    };
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        mockJson({
          runId,
          status: "previewed",
          summary: {
            valid: true,
            packageIssues: [],
            base: baseSummary,
            knowledge,
            issues: [],
          },
        }),
      )
      .mockResolvedValueOnce(
        mockJson({
          runId,
          status: "completed",
          result: {
            recordsCreated: 1,
            recordsSkipped: 1,
            categoriesCreated: 0,
            categoriesReused: 1,
            relationshipsCreated: 1,
            claimsCreated: 1,
            claimsSkipped: 0,
            claimsRepaired: 0,
            evidenceCreated: 1,
            evidenceSkipped: 0,
            evidenceRepaired: 0,
            attachmentsCreated: 1,
            attachmentsSkipped: 0,
            attachmentsRepaired: 0,
            historicalContext: knowledge.historicalContext,
            downgraded: knowledge.downgraded,
          },
        }),
      );

    render(React.createElement(DataTransferPanel));
    fireEvent.change(screen.getByLabelText(/KnowTrace 文件/), {
      target: { files: [new File(["PK"], "knowtrace.zip", { type: "application/zip" })] },
    });
    fireEvent.click(screen.getByRole("button", { name: "开始预检" }));
    const confirm = await screen.findByRole("button", { name: "确认导入" });
    fireEvent.click(confirm);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      `/api/data-transfer/v2/import/${runId}/confirm`,
    );
    expect(await screen.findByText(/主张新增 1\/跳过 0\/修复 0/)).toBeTruthy();
  });
});
