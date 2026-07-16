import { NextRequest } from 'next/server';
import { z } from 'zod';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { conflict, notFound, success, validationError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { withAuthContext, type AuthContext, type AuthRouteContext } from '@/lib/auth/context';
import { acquireAdvisoryTxLock } from '@/lib/db/advisory-lock';
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
const expectedUpdatedAtSchema = z.string().datetime('文書テンプレートの版情報が不正です');

const updateTemplateSchema = z.object({
  expected_updated_at: expectedUpdatedAtSchema,
  name: z.string().trim().min(1, 'テンプレート名は必須です').max(500).optional(),
  template_type: templateTypeSchema.optional(),
  target_role: z.string().trim().min(1).max(100).nullable().optional(),
  format: templateFormatSchema.optional(),
  version: z.number().int().min(1).optional(),
  effective_from: z.string().date().nullable().optional(),
  effective_to: z.string().date().nullable().optional(),
  content: z.record(z.string(), z.unknown()).optional(),
  is_default: z.boolean().optional(),
});

const deleteTemplateQuerySchema = z.object({
  expected_updated_at: expectedUpdatedAtSchema,
});

const templateDetailSelect = {
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
} as const;

function parseEffectiveDate(value: string | null) {
  return value === null ? null : new Date(`${value}T00:00:00.000Z`);
}

function staleTemplateConflict(expected: string, current: Date | null) {
  return conflict('文書テンプレートが更新されています。再読み込みしてください', {
    conflict_type: 'stale_document_template',
    expected_updated_at: expected,
    current_updated_at: current?.toISOString() ?? null,
  });
}

async function templateGET(
  _req: NextRequest,
  ctx: AuthContext,
  { params }: AuthRouteContext<{ id: string }>,
) {
  const { id: rawId } = await params;
  const templateId = normalizeRequiredRouteParam(rawId);
  if (!templateId) return withSensitiveNoStore(validationError('文書テンプレートIDが不正です'));

  const template = await withOrgContext(
    ctx.orgId,
    (tx) =>
      tx.template.findFirst({
        where: { id: templateId, org_id: ctx.orgId },
        select: templateDetailSelect,
      }),
    { requestContext: ctx },
  );
  if (!template) return withSensitiveNoStore(notFound('文書テンプレートが見つかりません'));

  return withSensitiveNoStore(success({ data: template }));
}

export const GET = withAuthContext(templateGET, {
  permission: 'canAdmin',
  message: '文書テンプレートの閲覧権限がありません',
});

async function templatePATCH(
  req: NextRequest,
  ctx: AuthContext,
  { params }: AuthRouteContext<{ id: string }>,
) {
  const { id: rawId } = await params;
  const templateId = normalizeRequiredRouteParam(rawId);
  if (!templateId) return withSensitiveNoStore(validationError('文書テンプレートIDが不正です'));

  const payload = await readJsonObjectRequestBody(req);
  if (!payload) return withSensitiveNoStore(validationError('リクエストボディが不正です'));

  const parsed = updateTemplateSchema.safeParse(payload);
  if (!parsed.success) {
    return withSensitiveNoStore(
      validationError('入力値が不正です', parsed.error.flatten().fieldErrors),
    );
  }

  const { expected_updated_at: expectedUpdatedAtRaw, ...updateData } = parsed.data;
  const expectedUpdatedAt = new Date(expectedUpdatedAtRaw);
  const result = await withOrgContext(
    ctx.orgId,
    async (tx) => {
      const existing = await tx.template.findFirst({
        where: { id: templateId, org_id: ctx.orgId },
        select: {
          template_type: true,
          is_default: true,
          effective_from: true,
          effective_to: true,
          updated_at: true,
        },
      });
      if (!existing) return { status: 'not_found' as const };
      if (existing.updated_at.toISOString() !== expectedUpdatedAt.toISOString()) {
        return { status: 'stale' as const, currentUpdatedAt: existing.updated_at };
      }

      const nextTemplateType = updateData.template_type ?? existing.template_type;
      const nextIsDefault = updateData.is_default ?? existing.is_default;
      const nextEffectiveFrom =
        updateData.effective_from === undefined
          ? existing.effective_from
          : parseEffectiveDate(updateData.effective_from);
      const nextEffectiveTo =
        updateData.effective_to === undefined
          ? existing.effective_to
          : parseEffectiveDate(updateData.effective_to);
      if (nextEffectiveFrom && nextEffectiveTo && nextEffectiveFrom >= nextEffectiveTo) {
        return { status: 'invalid_period' as const };
      }

      if (nextIsDefault) {
        await acquireAdvisoryTxLock(
          tx,
          'document_template_default',
          `${ctx.orgId}:${nextTemplateType}`,
        );
      }

      const claimed = await tx.template.updateMany({
        where: { id: templateId, org_id: ctx.orgId, updated_at: expectedUpdatedAt },
        data: {
          ...(updateData.name ? { name: updateData.name } : {}),
          ...(updateData.template_type ? { template_type: updateData.template_type } : {}),
          ...(updateData.target_role !== undefined ? { target_role: updateData.target_role } : {}),
          ...(updateData.format ? { format: updateData.format } : {}),
          ...(updateData.version ? { version: updateData.version } : {}),
          ...(updateData.effective_from !== undefined ? { effective_from: nextEffectiveFrom } : {}),
          ...(updateData.effective_to !== undefined ? { effective_to: nextEffectiveTo } : {}),
          ...(updateData.content !== undefined
            ? { content: toPrismaJsonInput(updateData.content) }
            : {}),
          ...(updateData.is_default !== undefined ? { is_default: updateData.is_default } : {}),
        },
      });
      if (claimed.count !== 1) {
        const current = await tx.template.findFirst({
          where: { id: templateId, org_id: ctx.orgId },
          select: { updated_at: true },
        });
        return { status: 'stale' as const, currentUpdatedAt: current?.updated_at ?? null };
      }

      if (nextIsDefault) {
        await tx.template.updateMany({
          where: {
            org_id: ctx.orgId,
            template_type: nextTemplateType,
            is_default: true,
            id: { not: templateId },
          },
          data: { is_default: false },
        });
      }

      const updated = await tx.template.findFirst({
        where: { id: templateId, org_id: ctx.orgId },
        select: templateDetailSelect,
      });
      return updated
        ? { status: 'updated' as const, updated }
        : { status: 'stale' as const, currentUpdatedAt: null };
    },
    { requestContext: ctx },
  );

  if (result.status === 'not_found') {
    return withSensitiveNoStore(notFound('文書テンプレートが見つかりません'));
  }
  if (result.status === 'invalid_period') {
    return withSensitiveNoStore(
      validationError('入力値が不正です', {
        effective_to: ['適用終了日は適用開始日より後にしてください'],
      }),
    );
  }
  if (result.status === 'stale') {
    return withSensitiveNoStore(
      staleTemplateConflict(expectedUpdatedAtRaw, result.currentUpdatedAt),
    );
  }
  return withSensitiveNoStore(success({ data: result.updated }));
}

export const PATCH = withAuthContext(templatePATCH, {
  permission: 'canAdmin',
  message: '文書テンプレートの更新権限がありません',
});

async function templateDELETE(
  req: NextRequest,
  ctx: AuthContext,
  { params }: AuthRouteContext<{ id: string }>,
) {
  const { id: rawId } = await params;
  const templateId = normalizeRequiredRouteParam(rawId);
  if (!templateId) return withSensitiveNoStore(validationError('文書テンプレートIDが不正です'));

  const expectedUpdatedAtValues = req.nextUrl.searchParams.getAll('expected_updated_at');
  const parsedQuery = deleteTemplateQuerySchema.safeParse({
    expected_updated_at:
      expectedUpdatedAtValues.length === 1 ? expectedUpdatedAtValues[0] : undefined,
  });
  if (!parsedQuery.success) {
    return withSensitiveNoStore(
      validationError('クエリパラメータが不正です', parsedQuery.error.flatten().fieldErrors),
    );
  }
  const expectedUpdatedAt = new Date(parsedQuery.data.expected_updated_at);

  const result = await withOrgContext(
    ctx.orgId,
    async (tx) => {
      const existing = await tx.template.findFirst({
        where: { id: templateId, org_id: ctx.orgId },
        select: { id: true, updated_at: true },
      });
      if (!existing) return { status: 'not_found' as const };
      if (existing.updated_at.toISOString() !== expectedUpdatedAt.toISOString()) {
        return { status: 'stale' as const, currentUpdatedAt: existing.updated_at };
      }

      const deleted = await tx.template.deleteMany({
        where: { id: templateId, org_id: ctx.orgId, updated_at: expectedUpdatedAt },
      });
      if (deleted.count !== 1) {
        const current = await tx.template.findFirst({
          where: { id: templateId, org_id: ctx.orgId },
          select: { updated_at: true },
        });
        return { status: 'stale' as const, currentUpdatedAt: current?.updated_at ?? null };
      }
      return { status: 'deleted' as const, id: existing.id };
    },
    { requestContext: ctx },
  );

  if (result.status === 'not_found') {
    return withSensitiveNoStore(notFound('文書テンプレートが見つかりません'));
  }
  if (result.status === 'stale') {
    return withSensitiveNoStore(
      staleTemplateConflict(parsedQuery.data.expected_updated_at, result.currentUpdatedAt),
    );
  }
  return withSensitiveNoStore(success({ data: { id: result.id } }));
}

export const DELETE = withAuthContext(templateDELETE, {
  permission: 'canAdmin',
  message: '文書テンプレートの削除権限がありません',
});
