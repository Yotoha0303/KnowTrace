import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

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
        <span>{CONTENT_TYPE_LABELS[capture.contentType]}</span>
        <time dateTime={capture.createdAt}>{dateFormatter.format(new Date(capture.createdAt))}</time>
      </div>
      <h3>{capture.title || "未命名记录"}</h3>
      <p>{excerpt}</p>
      <div className="capture-card-footer">
        <div className="tag-row">
          {capture.categories.slice(0, 3).map((category) => (
            <span className="tag" key={category.id}>{category.name}</span>
          ))}
        </div>
        <ArrowUpRight size={17} />
      </div>
    </Link>
  );
}
