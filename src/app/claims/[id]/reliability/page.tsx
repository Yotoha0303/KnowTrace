import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, BadgeCheck } from "lucide-react";

import { ReliabilityPanel } from "@/components/reliability-panel";
import { currentActionActor } from "@/features/auth/actor";
import { getReliabilityDossier } from "@/features/reliability/queries";

export const dynamic = "force-dynamic";

export default async function ReliabilityPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const actor = await currentActionActor();
  const dossier = await getReliabilityDossier(id, actor);
  if (!dossier) notFound();

  return (
    <div className="page-shell">
      <header className="collection-header reliability-page-header">
        <div>
          <Link className="back-link" href={`/captures/${dossier.claim.captureId}#claims`}>
            <ArrowLeft size={16} /> 返回主张与证据
          </Link>
          <p className="eyebrow">Reliable knowledge release</p>
          <h1>可靠发布审查</h1>
          <p>{dossier.claim.statement}</p>
        </div>
        <BadgeCheck size={32} />
      </header>
      <ReliabilityPanel actor={actor} dossier={dossier} />
    </div>
  );
}
