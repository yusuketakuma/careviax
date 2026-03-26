import { NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError, notFound } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import { z } from 'zod';
import { upsertBillingEvidenceForVisit } from '@/server/services/billing-evidence';
import { resolveOperationalTasks } from '@/server/services/operational-tasks';

const sendCareReportSchema = z.object({
  channel: z.enum(['email', 'fax', 'phone', 'in_person', 'postal', 'ses']),
  recipient_name: z.string().min(1, '送付先氏名は必須です'),
  recipient_contact: z.string().min(1, '送付先連絡先は必須です'),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuthContext(req, {
    permission: 'canReport',
    message: '報告書送信の権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;

  const { id } = await params;

  const body = await req.json().catch(() => null);
  if (!body) return validationError('リクエストボディが不正です');

  const parsed = sendCareReportSchema.safeParse(body);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const existing = await prisma.careReport.findFirst({
    where: { id, org_id: ctx.orgId },
    select: { id: true, status: true, visit_record_id: true },
  });
  if (!existing) return notFound('報告書が見つかりません');

  const result = await withOrgContext(ctx.orgId, async (tx) => {
    // DeliveryRecord を作成し、MVPではステータスを sent に設定
    const deliveryRecord = await tx.deliveryRecord.create({
      data: {
        org_id: ctx.orgId,
        report_id: id,
        channel: parsed.data.channel,
        recipient_name: parsed.data.recipient_name,
        recipient_contact: parsed.data.recipient_contact,
        status: 'sent',
        sent_at: new Date(),
      },
    });

    // 報告書のステータスも sent に更新
    const report = await tx.careReport.update({
      where: { id },
      data: { status: 'sent' },
    });

    if (existing.visit_record_id) {
      const schedule = await tx.visitRecord.findFirst({
        where: {
          id: existing.visit_record_id,
          org_id: ctx.orgId,
        },
        select: {
          schedule: {
            select: {
              cycle_id: true,
            },
          },
        },
      });

      if (schedule?.schedule.cycle_id) {
        const siblingReports = await tx.careReport.findMany({
          where: {
            org_id: ctx.orgId,
            visit_record_id: existing.visit_record_id,
          },
          select: { status: true },
        });

        const allReportsDelivered =
          siblingReports.length > 0 &&
          siblingReports.every(
            (siblingReport) =>
              siblingReport.status === 'sent' ||
              siblingReport.status === 'confirmed'
          );

        if (allReportsDelivered) {
          await tx.medicationCycle.updateMany({
            where: {
              id: schedule.schedule.cycle_id,
              org_id: ctx.orgId,
              overall_status: {
                in: ['visit_ready', 'visit_completed'],
              },
            },
            data: {
              overall_status: 'reported',
            },
          });

          await resolveOperationalTasks(tx, {
            orgId: ctx.orgId,
            dedupeKey: `care-report-followup:${existing.visit_record_id}`,
            status: 'completed',
          });

          await upsertBillingEvidenceForVisit(tx, {
            orgId: ctx.orgId,
            visitRecordId: existing.visit_record_id,
          });
        }
      }
    }

    return { report, deliveryRecord };
  });

  return success({ data: result });
}
