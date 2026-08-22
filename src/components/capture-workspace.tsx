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
      />
      <AIReviewPanel
        capture={capture}
        categories={categories}
        editorReady={editorState.ready}
        hasUnsavedChanges={editorState.hasUnsavedChanges}
        key={`ai-${capture.version}-${capture.aiHistory[0]?.id ?? "none"}`}
      />
    </div>
  );
}
