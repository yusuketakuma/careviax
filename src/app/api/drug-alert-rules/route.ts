import { NextRequest } from 'next/server';
import { z } from 'zod';
import { parseBoundedInteger } from '@/lib/api/pagination';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { requireAuthContext } from '@/lib/auth/context';
import { success, validationError } from '@/lib/api/response';
import { toPrismaJsonInput } from '@/lib/db/json';
import { withOrgContext } from '@/lib/db/rls';

const DEFAULT_DRUG_ALERT_RULE_LIMIT = 200;
const MAX_DRUG_ALERT_RULE_LIMIT = 500;

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

const createDrugAlertRuleSchema = z.object({
  alert_type: alertTypeSchema,
  condition: z.record(z.string(), z.unknown()).default({}),
  severity: alertSeveritySchema,
  message: z.string().trim().min(1, 'message は必須です'),
  is_active: z.boolean().default(true),
});

export async function GET(req: NextRequest) {
  const authResult = await requireAuthContext(req, { permission: 'canAdmin' });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  const { searchParams } = new URL(req.url);
  const alertTypeParam = searchParams.get('alert_type');
  const alertType = alertTypeParam ? alertTypeSchema.safeParse(alertTypeParam) : null;
  if (alertType && !alertType.success) {
    return validationError('アラート種別が不正です', {
      alert_type: ['対応していないアラート種別です'],
    });
  }
  const limit = parseBoundedInteger(
    searchParams.get('limit'),
    DEFAULT_DRUG_ALERT_RULE_LIMIT,
    1,
    MAX_DRUG_ALERT_RULE_LIMIT,
  );

  const rules = await withOrgContext(ctx.orgId, (tx) =>
    tx.drugAlertRule.findMany({
      where: {
        ...(alertType ? { alert_type: alertType.data } : {}),
        OR: [{ org_id: ctx.orgId }, { org_id: null }],
      },
      orderBy: [{ alert_type: 'asc' }, { org_id: 'desc' }, { updated_at: 'desc' }],
      take: limit,
    }),
  );

  return success({ data: rules });
}

export async function POST(req: NextRequest) {
  const authResult = await requireAuthContext(req, { permission: 'canAdmin' });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  const payload = await readJsonObjectRequestBody(req);
  if (!payload) return validationError('リクエストボディが不正です');

  const parsed = createDrugAlertRuleSchema.safeParse(payload);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const rule = await withOrgContext(ctx.orgId, (tx) =>
    tx.drugAlertRule.create({
      data: {
        org_id: ctx.orgId,
        alert_type: parsed.data.alert_type,
        condition: toPrismaJsonInput(parsed.data.condition),
        severity: parsed.data.severity,
        message: parsed.data.message,
        is_active: parsed.data.is_active,
      },
    }),
  );

  return success({ data: rule }, 201);
}
