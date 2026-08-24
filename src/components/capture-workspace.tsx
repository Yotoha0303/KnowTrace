"use client";

import { useCallback, useState } from "react";

import { AIReviewPanel } from "@/components/ai-review-panel";
import { CaptureEditor } from "@/components/capture-editor";
import type { CaptureDetailDTO, CategoryDTO } from "@/features/capture/queries";

export function CaptureWorkspace({
  capture,
  categories,
}: {
  capture: CaptureDetailDTO;
  categories: CategoryDTO[];
}) {
  const [editorState, setEditorState] = useState({
    ready: false,
    hasUnsavedChanges: false,
  });
  const handleDirtyChange = useCallback((hasUnsavedChanges: boolean) => {
    setEditorState((current) =>
      current.ready && current.hasUnsavedChanges === hasUnsavedChanges
        ? current
        : { ready: true, hasUnsavedChanges },
    );
  }, []);

  return (
    <div className="detail-grid">
      <CaptureEditor
        capture={capture}
        categories={categories}
        key={`editor-${capture.version}`}
        onDirtyChange={handleDirtyChange}
        readOnly={!capture.canManage}
      />
      {capture.canManage ? (
        <AIReviewPanel
          capture={capture}
          categories={categories.filter((category) => category.canManage)}
          editorReady={editorState.ready}
          hasUnsavedChanges={editorState.hasUnsavedChanges}
          key={`ai-${capture.version}-${capture.aiHistory[0]?.id ?? "none"}`}
        />
      ) : (
        <aside className="ai-panel shared-readonly-panel">
          <p className="eyebrow">Shared by administrator</p>
          <h2>管理员共享内容</h2>
          <p>你可以阅读原始记录及其主张、证据和结论；AI 整理与修改只由内容所有者或管理员执行。</p>
        </aside>
      )}
    </div>
  );
}
