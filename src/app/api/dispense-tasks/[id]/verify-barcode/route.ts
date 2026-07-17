import { NextRequest } from 'next/server';
import { withAuthContext, type AuthContext, type AuthRouteContext } from '@/lib/auth/context';
import { success, validationError, notFound } from '@/lib/api/response';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { prisma } from '@/lib/db/client';
import { z } from 'zod';
import { buildMedicationCycleAssignmentWhere } from '@/server/services/prescription-access';
import { verifyDispenseBarcodeForLine } from '@/lib/dispensing/dispense-barcode-verification';

const verifyBarcodeSchema = z.object({
  barcode: z.string().min(1, 'バーコードは必須です'),
  line_id: z.string().min(1, '処方明細IDは必須です'),
});

async function authenticatedPOST(
  req: NextRequest,
  ctx: AuthContext,
  routeContext: AuthRouteContext<{ id: string }>,
) {
  const { id: rawId } = await routeContext.params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return validationError('調剤タスクIDが不正です');

  const cycleAssignmentWhere = buildMedicationCycleAssignmentWhere(ctx);

  const payload = await readJsonObjectRequestBody(req);
  if (!payload) return validationError('リクエストボディが不正です');

  const parsed = verifyBarcodeSchema.safeParse(payload);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const task = await prisma.dispenseTask.findFirst({
    where: {
      id,
      org_id: ctx.orgId,
      ...(cycleAssignmentWhere ? { cycle: cycleAssignmentWhere } : {}),
    },
    select: { id: true, cycle_id: true },
  });
  if (!task) return notFound('タスクが見つかりません');

  const { barcode, line_id } = parsed.data;

  const line = await prisma.prescriptionLine.findFirst({
    where: {
      id: line_id,
      org_id: ctx.orgId,
      intake: {
        cycle_id: task.cycle_id,
      },
    },
    select: {
      id: true,
      drug_code: true,
      drug_name: true,
    },
  });
  if (!line) return notFound('処方明細が見つかりません');

  const verification = await verifyDispenseBarcodeForLine({
    client: prisma,
    line,
    barcode,
  });

  return success({
    data: {
      match: verification.match,
      decoded: verification.decoded,
      expected: verification.expected,
      warnings: verification.warnings,
    },
  });
}

export const POST = withAuthContext(authenticatedPOST, {
  permission: 'canDispense',
  message: 'バーコード照合権限がありません',
});
