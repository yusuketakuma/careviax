import { NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError, notFound } from '@/lib/api/response';
import { updateInquiryRecordSchema } from '@/lib/validations/prescription';
import { prisma } from '@/lib/db/client';

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
    select: { id: true, cycle_id: true, line_id: true, result: true },
  });
  if (!existing) return notFound('疑義照会記録が見つかりません');

  const { result, change_detail, resolved_at } = parsed.data;

  const inquiry = await withOrgContext(ctx.orgId, async (tx) => {
    const updated = await tx.inquiryRecord.update({
      where: { id },
      data: {
        ...(result !== undefined ? { result } : {}),
        ...(change_detail !== undefined ? { change_detail } : {}),
        ...(resolved_at ? { resolved_at: new Date(resolved_at) } : {}),
      },
    });

    // When result is resolved (changed or unchanged), transition cycle status
    if (result === 'changed' || result === 'unchanged') {
      await tx.medicationCycle.update({
        where: { id: existing.cycle_id },
        data: { overall_status: 'inquiry_resolved' },
      });
    }

    return updated;
  });

  return success(inquiry);
}
