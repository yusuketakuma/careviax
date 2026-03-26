import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError } from '@/lib/api/response';
import { createInquiryRecordSchema } from '@/lib/validations/prescription';
import { prisma } from '@/lib/db/client';

export const GET = withAuth(async (req: AuthenticatedRequest) => {
  const { searchParams } = new URL(req.url);
  const cycleId = searchParams.get('cycle_id') ?? undefined;

  const where = {
    org_id: req.orgId,
    ...(cycleId ? { cycle_id: cycleId } : {}),
  };

  const records = await prisma.inquiryRecord.findMany({
    where,
    orderBy: { inquired_at: 'desc' },
    select: {
      id: true,
      cycle_id: true,
      line_id: true,
      reason: true,
      inquiry_to_physician: true,
      inquiry_content: true,
      result: true,
      change_detail: true,
      inquired_at: true,
      resolved_at: true,
      created_at: true,
      updated_at: true,
      line: {
        select: {
          drug_name: true,
          line_number: true,
        },
      },
    },
  });

  return success({ data: records });
}, {
  permission: 'canVisit',
  message: '問い合わせ記録の閲覧権限がありません',
});

export const POST = withAuth(async (req: AuthenticatedRequest) => {
  const body = await req.json().catch(() => null);
  if (!body) return validationError('リクエストボディが不正です');

  const parsed = createInquiryRecordSchema.safeParse(body);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const { cycle_id, inquired_at, ...rest } = parsed.data;

  const result = await withOrgContext(req.orgId, async (tx) => {
    // Verify cycle belongs to this org
    const cycle = await tx.medicationCycle.findFirst({
      where: { id: cycle_id, org_id: req.orgId },
      select: { id: true, overall_status: true },
    });
    if (!cycle) return null;

    // Create inquiry record
    const inquiry = await tx.inquiryRecord.create({
      data: {
        org_id: req.orgId,
        cycle_id,
        inquired_at: new Date(inquired_at),
        ...rest,
      },
    });

    // Transition MedicationCycle status to inquiry_pending
    await tx.medicationCycle.update({
      where: { id: cycle_id },
      data: { overall_status: 'inquiry_pending' },
    });

    return inquiry;
  });

  if (!result) {
    return validationError('指定されたサイクルが見つかりません');
  }

  return success(result, 201);
}, {
  permission: 'canVisit',
  message: '問い合わせ記録の作成権限がありません',
});
