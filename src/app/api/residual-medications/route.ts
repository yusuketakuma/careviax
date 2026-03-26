import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError, notFound } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import { z } from 'zod';

export const GET = withAuth(async (req: AuthenticatedRequest) => {
  const { searchParams } = new URL(req.url);
  const visitRecordId = searchParams.get('visit_record_id') ?? undefined;

  const records = await prisma.residualMedication.findMany({
    where: {
      org_id: req.orgId,
      ...(visitRecordId ? { visit_record_id: visitRecordId } : {}),
    },
    orderBy: { created_at: 'asc' },
  });

  return success({ data: records });
}, {
  permission: 'canVisit',
  message: '残薬情報の閲覧権限がありません',
});

const createResidualMedicationSchema = z.object({
  visit_record_id: z.string().min(1, '訪問記録IDは必須です'),
  medications: z.array(
    z.object({
      drug_name: z.string().min(1, '薬剤名は必須です'),
      drug_code: z.string().optional(),
      prescribed_quantity: z.number().positive().optional(),
      prescribed_daily_dose: z.number().positive().optional(),
      remaining_quantity: z.number().min(0, '残数は0以上で入力してください'),
      is_prohibited_reduction: z.boolean().default(false),
    })
  ).min(1, '薬剤情報は1件以上必要です'),
});

export const POST = withAuth(async (req: AuthenticatedRequest) => {
  const body = await req.json().catch(() => null);
  if (!body) return validationError('リクエストボディが不正です');

  const parsed = createResidualMedicationSchema.safeParse(body);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const { visit_record_id, medications } = parsed.data;

  const result = await withOrgContext(req.orgId, async (tx) => {
    // Verify visit record belongs to this org
    const visitRecord = await tx.visitRecord.findFirst({
      where: { id: visit_record_id, org_id: req.orgId },
      select: { id: true },
    });
    if (!visitRecord) return null;

    const created = await Promise.all(
      medications.map((med) => {
        // Calculate excess days: remaining_quantity / prescribed_daily_dose
        let excess_days: number | undefined;
        if (
          med.prescribed_daily_dose &&
          med.prescribed_daily_dose > 0 &&
          med.remaining_quantity > 0
        ) {
          excess_days = Math.floor(med.remaining_quantity / med.prescribed_daily_dose);
        }

        return tx.residualMedication.create({
          data: {
            org_id: req.orgId,
            visit_record_id,
            drug_name: med.drug_name,
            drug_code: med.drug_code,
            prescribed_quantity: med.prescribed_quantity,
            remaining_quantity: med.remaining_quantity,
            excess_days: excess_days ?? null,
            is_reduction_target:
              excess_days !== undefined && excess_days > 7,
            is_prohibited_reduction: med.is_prohibited_reduction,
          },
        });
      })
    );

    return created;
  });

  if (!result) return notFound('指定された訪問記録が見つかりません');

  return success(result, 201);
}, {
  permission: 'canVisit',
  message: '残薬情報の作成権限がありません',
});
