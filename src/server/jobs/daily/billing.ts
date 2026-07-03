import { prisma } from '@/lib/db/client';
import { withOrgContext } from '@/lib/db/rls';
import { runJob } from '../runner';
import { upsertBillingEvidenceForVisit } from '@/server/services/billing-evidence';

export async function generateBillingEvidenceDaily() {
  return runJob('billing_evidence_generation', async () => {
    // テナント（Organization）を列挙し、既存 evidence の除外・未処理 visit の抽出を
    // すべて org_id でスコープする。RLS が効く billing_evidence / visit_record を
    // org context 無しでグローバルに findMany すると、テナント跨ぎの取り違えや
    // （app_user 接続時の）0件フォールバックで evidence 生成が静かに漏れる。
    const orgs = await prisma.organization.findMany({
      select: { id: true },
    });

    let processedCount = 0;

    for (const org of orgs) {
      // org context 内で「未 evidence の visit_record id」を抽出（読み取りも org スコープ）。
      const pendingVisitRecordIds = await withOrgContext(org.id, async (tx) => {
        const existingEvidence = await tx.billingEvidence.findMany({
          where: { org_id: org.id },
          select: { visit_record_id: true },
        });
        const existingVisitRecordIds = existingEvidence.map((record) => record.visit_record_id);

        const visitRecords = await tx.visitRecord.findMany({
          where: {
            org_id: org.id,
            ...(existingVisitRecordIds.length > 0 ? { id: { notIn: existingVisitRecordIds } } : {}),
          },
          select: { id: true },
        });

        return visitRecords.map((visitRecord) => visitRecord.id);
      });

      // upsert は visit 単位で独立トランザクションに分ける（1テナントの大量 visit を
      // 単一トランザクションに詰め込んでタイムアウトさせない従来の粒度を維持）。
      for (const visitRecordId of pendingVisitRecordIds) {
        await withOrgContext(org.id, (tx) =>
          upsertBillingEvidenceForVisit(tx, {
            orgId: org.id,
            visitRecordId,
          }),
        );
        processedCount += 1;
      }
    }

    return { processedCount };
  });
}
