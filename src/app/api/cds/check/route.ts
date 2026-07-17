import { NextRequest } from 'next/server';
import { withAuthContext, type AuthContext } from '@/lib/auth/context';
import { runWithRequestAuthContext } from '@/lib/auth/request-context';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { success, validationError, notFound } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import { checkDispenseAlerts } from '@/server/cds/checker';
import { z } from 'zod';

const cdsCheckSchema = z.object({
  cycleId: z.string().min(1),
  patientId: z.string().min(1).optional(),
});

async function cdsCheckPOST(req: NextRequest, ctx: AuthContext) {
  return runWithRequestAuthContext(ctx, async () => {
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = cdsCheckSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const { cycleId } = parsed.data;

    // Verify the cycle belongs to this org
    const cycle = await prisma.medicationCycle.findFirst({
      where: { id: cycleId, org_id: ctx.orgId },
      select: { id: true, patient_id: true },
    });

    if (!cycle) return notFound('指定されたサイクルが見つかりません');

    // Use the patientId from the cycle for security (prevent cross-patient access)
    const alerts = await checkDispenseAlerts(ctx.orgId, cycleId, cycle.patient_id);

    return success({ data: { alerts } });
  });
}

export const POST = withAuthContext(cdsCheckPOST, {
  permission: 'canVisit',
  message: '処方安全チェックの実行権限がありません',
});
