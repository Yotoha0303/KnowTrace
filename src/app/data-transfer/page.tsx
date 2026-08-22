import { ArrowLeftRight, DatabaseBackup } from "lucide-react";

import { DataTransferPanel } from "@/components/data-transfer-panel";

export default function DataTransferPage() {
  return (
    <div className="page-shell data-transfer-page">
      <header className="page-header">
        <div>
          <p className="eyebrow"><ArrowLeftRight size={13} /> 数据迁移</p>
          <h1>导出与导入</h1>
          <p className="page-description">用 Excel 搬运原始记录、对象、时间和分类。导入前会先预检，不会直接写入数据库。</p>
        </div>
        <div className="status-pill"><span /> XLSX 格式 v1</div>
      </header>
      <div className="transfer-boundary-notice">
        <DatabaseBackup size={20} />
        <div><strong>Excel 不是完整备份</strong><p>AI 历史、主张、证据、审核、可靠知识发布和图片不会进入 Excel。灾难恢复仍需同时备份 PostgreSQL 数据库与项目的 data/uploads。</p></div>
      </div>
      <DataTransferPanel />
    </div>
  );
}
