import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError, notFound } from '@/lib/api/response';
import { createCaseSchema } from '@/lib/validations/case';
import { prisma } from '@/lib/db/client';

export const POST = withAuth(async (req: AuthenticatedRequest) => {
  const body = await req.json().catch(() => null);
  if (!body) return validationError('リクエストボディが不正です');

  const parsed = createCaseSchema.safeParse(body);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const { patient_id, referral_date, ...rest } = parsed.data;

  // Verify patient belongs to org
  const patient = await prisma.patient.findFirst({
    where: { id: patient_id, org_id: req.orgId },
  });
  if (!patient) return notFound('患者が見つかりません');

  const careCase = await withOrgContext(req.orgId, async (tx) => {
    return tx.careCase.create({
      data: {
        org_id: req.orgId,
        patient_id,
        ...(referral_date ? { referral_date: new Date(referral_date) } : {}),
        ...rest,
      },
    });
  });

  return success(careCase, 201);
});
