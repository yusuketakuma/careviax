import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuthContext } from '@/lib/auth/context';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { success, validationError, notFound } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import { toPrismaJsonInput } from '@/lib/db/json';
import { withOrgContext } from '@/lib/db/rls';

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

const updateTemplateSchema = z.object({
  name: z.string().trim().min(1, 'テンプレート名は必須です').optional(),
  template_type: templateTypeSchema.optional(),
  target_role: z.string().trim().min(1).nullable().optional(),
  format: templateFormatSchema.optional(),
  version: z.number().int().min(1).optional(),
  effective_from: z.string().date().nullable().optional(),
  effective_to: z.string().date().nullable().optional(),
  content: z.record(z.string(), z.unknown()).optional(),
  is_default: z.boolean().optional(),
});

function parseEffectiveDate(value?: string | null) {
  if (value === null) return null;
  return value ? new Date(`${value}T00:00:00.000Z`) : undefined;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuthContext(req, {
    permission: 'canAdmin',
    message: '文書テンプレートの更新権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  const { id: rawId } = await params;
  const templateId = normalizeRequiredRouteParam(rawId);
  if (!templateId) return validationError('文書テンプレートIDが不正です');

  const payload = await readJsonObjectRequestBody(req);
  if (!payload) return validationError('リクエストボディが不正です');

  const parsed = updateTemplateSchema.safeParse(payload);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const existing = await prisma.template.findFirst({
    where: { id: templateId, org_id: ctx.orgId },
    select: {
      id: true,
      template_type: true,
    },
  });
  if (!existing) return notFound('文書テンプレートが見つかりません');

  const nextTemplateType = parsed.data.template_type ?? existing.template_type;
  const { effective_from, effective_to, ...rest } = parsed.data;

  const template = await withOrgContext(
    ctx.orgId,
    async (tx) => {
      if (parsed.data.is_default) {
        await tx.template.updateMany({
          where: {
            org_id: ctx.orgId,
            template_type: nextTemplateType,
            is_default: true,
            id: { not: templateId },
          },
          data: {
            is_default: false,
          },
        });
      }

      return tx.template.update({
        where: { id: templateId },
        data: {
          ...(rest.name ? { name: rest.name } : {}),
          ...(rest.template_type ? { template_type: rest.template_type } : {}),
          ...(rest.target_role !== undefined ? { target_role: rest.target_role || null } : {}),
          ...(rest.format ? { format: rest.format } : {}),
          ...(rest.version ? { version: rest.version } : {}),
          ...(effective_from !== undefined
            ? { effective_from: parseEffectiveDate(effective_from) }
            : {}),
          ...(effective_to !== undefined ? { effective_to: parseEffectiveDate(effective_to) } : {}),
          ...(rest.content !== undefined
            ? {
                content: toPrismaJsonInput(rest.content),
              }
            : {}),
          ...(rest.is_default !== undefined ? { is_default: rest.is_default } : {}),
        },
      });
    },
    { requestContext: ctx },
  );

  return success({ data: template });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuthContext(req, {
    permission: 'canAdmin',
    message: '文書テンプレートの削除権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  const { id: rawId } = await params;
  const templateId = normalizeRequiredRouteParam(rawId);
  if (!templateId) return validationError('文書テンプレートIDが不正です');

  const existing = await prisma.template.findFirst({
    where: { id: templateId, org_id: ctx.orgId },
    select: { id: true },
  });
  if (!existing) return notFound('文書テンプレートが見つかりません');

  await withOrgContext(
    ctx.orgId,
    (tx) =>
      tx.template.delete({
        where: { id: templateId },
      }),
    { requestContext: ctx },
  );

  return success({ message: '削除しました' });
}
