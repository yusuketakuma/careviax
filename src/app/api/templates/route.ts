import { NextRequest } from 'next/server';
import { z } from 'zod';
import { withAuthContext } from '@/lib/auth/context';
import { parseBoundedInteger } from '@/lib/api/pagination';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { success, validationError } from '@/lib/api/response';
import { toPrismaJsonInput } from '@/lib/db/json';
import { withOrgContext } from '@/lib/db/rls';

const DEFAULT_TEMPLATE_LIST_LIMIT = 100;
const MAX_TEMPLATE_LIST_LIMIT = 200;
const TEMPLATE_COUNT_BASIS = 'templates' as const;

const templateTypeSchema = z.enum([
  'care_report',
  'tracing_report',
  'management_plan',
  'medication_calendar',
  'contract_document',
  'important_matters',
  'privacy_consent',
  'consent_form',
]);

const templateFormatSchema = z.enum(['html', 'pdf']);

const targetRoleQuerySchema = z.string().trim().min(1).max(100);

const createTemplateSchema = z.object({
  name: z.string().trim().min(1, 'テンプレート名は必須です'),
  template_type: templateTypeSchema,
  target_role: z.string().trim().min(1).optional(),
  format: templateFormatSchema.default('html'),
  version: z.number().int().min(1).default(1),
  effective_from: z.string().date().optional(),
  effective_to: z.string().date().optional(),
  content: z.record(z.string(), z.unknown()),
  is_default: z.boolean().optional().default(false),
});

function parseEffectiveDate(value?: string) {
  return value ? new Date(`${value}T00:00:00.000Z`) : undefined;
}

function parseTemplateTypeFilter(searchParams: URLSearchParams) {
  const rawTemplateType = searchParams.get('template_type');
  if (rawTemplateType === null) return { ok: true as const, data: undefined };

  const templateType = rawTemplateType.trim();
  if (!templateType) {
    return {
      ok: false as const,
      response: validationError('クエリパラメータが不正です', {
        template_type: ['template_type が不正です'],
      }),
    };
  }

  const parsedTemplateType = templateTypeSchema.safeParse(templateType);
  if (!parsedTemplateType.success) {
    return {
      ok: false as const,
      response: validationError('クエリパラメータが不正です', {
        template_type: ['template_type が不正です'],
      }),
    };
  }

  return { ok: true as const, data: parsedTemplateType.data };
}

export const GET = withAuthContext(
  async (req, authCtx) => {
    const { searchParams } = new URL(req.url);
    const targetRoleRaw = searchParams.get('target_role');
    const parsedTemplateType = parseTemplateTypeFilter(searchParams);
    const parsedTargetRole =
      targetRoleRaw === null ? null : targetRoleQuerySchema.safeParse(targetRoleRaw);
    const limit = parseBoundedInteger(
      searchParams.get('limit'),
      DEFAULT_TEMPLATE_LIST_LIMIT,
      1,
      MAX_TEMPLATE_LIST_LIMIT,
    );

    if (!parsedTemplateType.ok) return parsedTemplateType.response;

    if (parsedTargetRole && !parsedTargetRole.success) {
      return validationError('クエリパラメータが不正です', {
        target_role: ['target_role が不正です'],
      });
    }

    const where = {
      org_id: authCtx.orgId,
      ...(parsedTemplateType.data ? { template_type: parsedTemplateType.data } : {}),
      ...(parsedTargetRole?.success ? { target_role: parsedTargetRole.data } : {}),
    };

    const { templates, totalCount } = await withOrgContext(
      authCtx.orgId,
      async (tx) => {
        const [rows, count] = await Promise.all([
          tx.template.findMany({
            where,
            orderBy: [
              { is_default: 'desc' },
              { template_type: 'asc' },
              { version: 'desc' },
              { updated_at: 'desc' },
            ],
            take: limit,
            select: {
              id: true,
              name: true,
              template_type: true,
              target_role: true,
              format: true,
              version: true,
              effective_from: true,
              effective_to: true,
              content: true,
              is_default: true,
              created_at: true,
              updated_at: true,
            },
          }),
          tx.template.count({ where }),
        ]);
        return { templates: rows, totalCount: count };
      },
      { requestContext: authCtx },
    );

    const visibleCount = templates.length;
    const hiddenCount = Math.max(totalCount - visibleCount, 0);

    return success({
      data: templates,
      total_count: totalCount,
      visible_count: visibleCount,
      hidden_count: hiddenCount,
      truncated: hiddenCount > 0,
      count_basis: TEMPLATE_COUNT_BASIS,
      filters_applied: {
        template_type: parsedTemplateType.data ?? null,
        target_role: parsedTargetRole?.success ? parsedTargetRole.data : null,
      },
      limit,
    });
  },
  { permission: 'canAdmin', message: '文書テンプレートの閲覧権限がありません' },
);

export const POST = withAuthContext(
  async (req: NextRequest, authCtx) => {
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = createTemplateSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const template = await withOrgContext(
      authCtx.orgId,
      async (tx) => {
        if (parsed.data.is_default) {
          await tx.template.updateMany({
            where: {
              org_id: authCtx.orgId,
              template_type: parsed.data.template_type,
              is_default: true,
            },
            data: {
              is_default: false,
            },
          });
        }

        return tx.template.create({
          data: {
            org_id: authCtx.orgId,
            name: parsed.data.name,
            template_type: parsed.data.template_type,
            target_role: parsed.data.target_role ?? null,
            format: parsed.data.format,
            version: parsed.data.version,
            effective_from: parseEffectiveDate(parsed.data.effective_from),
            effective_to: parseEffectiveDate(parsed.data.effective_to),
            content: toPrismaJsonInput(parsed.data.content),
            is_default: parsed.data.is_default,
          },
        });
      },
      { requestContext: authCtx },
    );

    return success({ data: template }, 201);
  },
  { permission: 'canAdmin', message: '文書テンプレートの作成権限がありません' },
);
