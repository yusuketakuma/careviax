import { NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError, notFound } from '@/lib/api/response';
import { updateInquiryRecordSchema } from '@/lib/validations/prescription';
import { prisma } from '@/lib/db/client';
import { resolveOperationalTasks } from '@/server/services/operational-tasks';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '問い合わせ記録の更新権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;

  const { id } = await params;

  const body = await req.json().catch(() => null);
  if (!body) return validationError('リクエストボディが不正です');

  const parsed = updateInquiryRecordSchema.safeParse(body);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const existing = await prisma.inquiryRecord.findFirst({
    where: { id, org_id: ctx.orgId },
    select: { id: true, cycle_id: true, line_id: true, issue_id: true, result: true },
  });
  if (!existing) return notFound('疑義照会記録が見つかりません');

  const { result, change_detail, resolved_at, line_update } = parsed.data;
  const resolvedAt =
    resolved_at != null
      ? new Date(resolved_at)
      : result === 'changed' || result === 'unchanged'
        ? new Date()
        : undefined;

  if (result === 'changed' && existing.line_id && !line_update) {
    return validationError('変更ありで確定する場合は処方明細の更新内容が必要です');
  }

  const inquiry = await withOrgContext(ctx.orgId, async (tx) => {
    if (result === 'changed' && existing.line_id && line_update) {
      await tx.prescriptionLine.update({
        where: { id: existing.line_id },
        data: {
          ...(line_update.drug_name !== undefined
            ? { drug_name: line_update.drug_name }
            : {}),
          ...(line_update.dose !== undefined ? { dose: line_update.dose } : {}),
          ...(line_update.frequency !== undefined
            ? { frequency: line_update.frequency }
            : {}),
          ...(line_update.days !== undefined ? { days: line_update.days } : {}),
        },
      });
    }

    const updated = await tx.inquiryRecord.update({
      where: { id },
      data: {
        ...(result !== undefined ? { result } : {}),
        ...(change_detail !== undefined ? { change_detail } : {}),
        ...(resolvedAt ? { resolved_at: resolvedAt } : {}),
      },
    });

    // When result is resolved (changed or unchanged), transition cycle status
    if (result === 'changed' || result === 'unchanged') {
      const remainingUnresolvedCount = await tx.inquiryRecord.count({
        where: {
          org_id: ctx.orgId,
          cycle_id: existing.cycle_id,
          id: { not: id },
          OR: [{ result: null }, { result: 'pending' }],
        },
      });

      await tx.medicationCycle.update({
        where: { id: existing.cycle_id },
        data: {
          overall_status:
            remainingUnresolvedCount === 0
              ? 'inquiry_resolved'
              : 'inquiry_pending',
        },
      });

      await resolveOperationalTasks(tx, {
        orgId: ctx.orgId,
        dedupeKey: `inquiry-workbench:${id}`,
        status: 'completed',
      });

      await tx.communicationRequest.updateMany({
        where: {
          org_id: ctx.orgId,
          related_entity_type: 'inquiry_record',
          related_entity_id: id,
          status: {
            in: ['draft', 'sent', 'received', 'in_progress', 'responded', 'escalated'],
          },
        },
        data: {
          status: 'closed',
        },
      });

      if (existing.issue_id) {
        await tx.medicationIssue.update({
          where: { id: existing.issue_id },
          data: {
            status: 'resolved',
            resolved_by: ctx.userId,
            resolved_at: resolvedAt ?? new Date(),
          },
        });
      }
    } else if (result === 'pending' && existing.issue_id) {
      await tx.medicationCycle.update({
        where: { id: existing.cycle_id },
        data: { overall_status: 'inquiry_pending' },
      });

      await tx.medicationIssue.update({
        where: { id: existing.issue_id },
        data: {
          status: 'in_progress',
          resolved_by: null,
          resolved_at: null,
        },
      });
    }

    return updated;
  });

  return success(inquiry);
}
