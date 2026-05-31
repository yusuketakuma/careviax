import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuthContext } from '@/lib/auth/context';
import { success, validationError, notFound } from '@/lib/api/response';
import { toPrismaJsonInput } from '@/lib/db/json';
import { withOrgContext } from '@/lib/db/rls';

const alertTypeSchema = z.enum([
  'interaction',
  'duplicate',
  'allergy_cross',
  'renal_dose',
  'pim_elderly',
  'high_risk',
  'narcotic',
  'max_days',
]);

const alertSeveritySchema = z.enum(['critical', 'warning', 'info']);

const updateDrugAlertRuleSchema = z.object({
  alert_type: alertTypeSchema.optional(),
  condition: z.record(z.string(), z.unknown()).optional(),
  severity: alertSeveritySchema.optional(),
  message: z.string().trim().min(1).optional(),
  is_active: z.boolean().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuthContext(req, { permission: 'canAdmin' });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  const body = await req.json().catch(() => null);
  if (!body) return validationError('リクエストボディが不正です');

  const parsed = updateDrugAlertRuleSchema.safeParse(body);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const { id } = await params;
  const existing = await withOrgContext(ctx.orgId, (tx) =>
    tx.drugAlertRule.findFirst({
      where: { id },
      select: { id: true },
    })
  );
  if (!existing) return notFound('処方安全アラートルールが見つかりません');

  const updated = await withOrgContext(ctx.orgId, (tx) =>
    tx.drugAlertRule.update({
      where: { id },
      data: {
        ...(parsed.data.alert_type ? { alert_type: parsed.data.alert_type } : {}),
        ...(parsed.data.condition !== undefined
          ? { condition: toPrismaJsonInput(parsed.data.condition) }
          : {}),
        ...(parsed.data.severity ? { severity: parsed.data.severity } : {}),
        ...(parsed.data.message ? { message: parsed.data.message } : {}),
        ...(parsed.data.is_active !== undefined ? { is_active: parsed.data.is_active } : {}),
      },
    })
  );

  return success({ data: updated });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuthContext(req, { permission: 'canAdmin' });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  const { id } = await params;
  const existing = await withOrgContext(ctx.orgId, (tx) =>
    tx.drugAlertRule.findFirst({
      where: { id },
      select: { id: true },
    })
  );
  if (!existing) return notFound('処方安全アラートルールが見つかりません');

  await withOrgContext(ctx.orgId, (tx) => tx.drugAlertRule.delete({ where: { id } }));

  return success({ message: '処方安全アラートルールを削除しました' });
}
