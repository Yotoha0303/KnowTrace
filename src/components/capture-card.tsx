import Link from "next/link";
import { ArrowUpRight, Contact } from "lucide-react";

import type { CaptureListItemDTO } from "@/features/capture/queries";
import { CONTENT_TYPE_LABELS } from "@/features/capture/schema";

const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Shanghai",
});

export function CaptureCard({ capture }: { capture: CaptureListItemDTO }) {
  const excerpt = capture.content.length > 180
    ? `${capture.content.slice(0, 177).trim()}…`
    : capture.content;

  return (
    <Link className="capture-card" href={`/captures/${capture.id}`}>
      <div className="capture-card-meta">
        <span>{CONTENT_TYPE_LABELS[capture.contentType]} · 创建者 {capture.createdByName}</span>
        <time dateTime={capture.occurredAt}>{dateFormatter.format(new Date(capture.occurredAt))}</time>
      </div>
      <h3>{capture.title || "未命名记录"}</h3>
      <p>{excerpt}</p>
      <div className="capture-card-footer">
        <div className="tag-row">
          {capture.subject ? <span className="subject-tag"><Contact size={11} />{capture.subject}</span> : null}
          {capture.categories.slice(0, 3).map((category) => (
            <span className="tag" key={category.id}>{category.name}</span>
          ))}
        </div>
        <ArrowUpRight size={17} />
      </div>
    </Link>
  );
}
