import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { success, validationError, notFound } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import { checkDispenseAlerts } from '@/server/cds/checker';
import { z } from 'zod';

const cdsCheckSchema = z.object({
  cycleId: z.string().min(1),
  patientId: z.string().min(1).optional(),
});

export const POST = withAuth(
  async (req: AuthenticatedRequest) => {
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = cdsCheckSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const { cycleId } = parsed.data;

    // Verify the cycle belongs to this org
    const cycle = await prisma.medicationCycle.findFirst({
      where: { id: cycleId, org_id: req.orgId },
      select: { id: true, patient_id: true },
    });

    if (!cycle) return notFound('指定されたサイクルが見つかりません');

    // Use the patientId from the cycle for security (prevent cross-patient access)
    const alerts = await checkDispenseAlerts(req.orgId, cycleId, cycle.patient_id);

    return success({ alerts });
  },
  {
    permission: 'canVisit',
    message: '処方安全チェックの実行権限がありません',
  },
);
