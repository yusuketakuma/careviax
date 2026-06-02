import { z } from 'zod';
import { NextRequest } from 'next/server';
import { withAuthContext, type AuthRouteContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError, notFound, forbidden, conflict } from '@/lib/api/response';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { prisma } from '@/lib/db/client';
import { hasPermission } from '@/lib/auth/permissions';
import { canAccessCaseScopedPatientResource } from '@/server/services/patient-access';
import type { ConsentRecord } from '@prisma/client';

const updateConsentSchema = z.object({
  expiry_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .nullable(),
  document_url: z.string().url().optional().nullable(),
});

type ConsentPatchResult =
  | { record: ConsentRecord }
  | { error: 'not_found' | 'conflict'; message?: string };

class ConsentPatchConflictError extends Error {}

export const GET = withAuthContext<{ id: string }>(
  async (req: NextRequest, ctx, routeContext: AuthRouteContext<{ id: string }>) => {
    if (!hasPermission(ctx.role, 'canVisit')) {
      return forbidden('同意記録の閲覧には訪問権限が必要です');
    }

    const { id: rawId } = await routeContext.params;
    const id = normalizeRequiredRouteParam(rawId);
    if (!id) return validationError('同意記録IDが不正です');

    const record = await prisma.consentRecord.findFirst({
      where: { id, org_id: ctx.orgId },
      select: { id: true, patient_id: true, case_id: true },
    });
    if (!record) return notFound('同意記録が見つかりません');

    const canAccessConsent = await canAccessCaseScopedPatientResource({
      db: prisma,
      orgId: ctx.orgId,
      patientId: record.patient_id,
      caseId: record.case_id,
      accessContext: ctx,
    });
    if (!canAccessConsent) return notFound('同意記録が見つかりません');

    const visibleRecord = await prisma.consentRecord.findFirst({
      where: { id, org_id: ctx.orgId },
    });
    if (!visibleRecord) return notFound('同意記録が見つかりません');

    return success(visibleRecord);
  },
  { permission: 'canVisit' },
);

export const PATCH = withAuthContext<{ id: string }>(
  async (req: NextRequest, ctx, routeContext: AuthRouteContext<{ id: string }>) => {
    if (!hasPermission(ctx.role, 'canVisit')) {
      return forbidden('同意記録の更新には訪問権限が必要です');
    }

    const { id: rawId } = await routeContext.params;
    const id = normalizeRequiredRouteParam(rawId);
    if (!id) return validationError('同意記録IDが不正です');

    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = updateConsentSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const existing = await prisma.consentRecord.findFirst({
      where: { id, org_id: ctx.orgId },
      select: { id: true, patient_id: true, case_id: true, updated_at: true },
    });
    if (!existing) return notFound('同意記録が見つかりません');

    const canAccessConsent = await canAccessCaseScopedPatientResource({
      db: prisma,
      orgId: ctx.orgId,
      patientId: existing.patient_id,
      caseId: existing.case_id,
      accessContext: ctx,
    });
    if (!canAccessConsent) return notFound('同意記録が見つかりません');

    const { expiry_date, document_url } = parsed.data;
    const updateData = {
      ...(expiry_date !== undefined
        ? { expiry_date: expiry_date ? new Date(expiry_date) : null }
        : {}),
      ...(document_url !== undefined ? { document_url } : {}),
    };

    const result = await withOrgContext(ctx.orgId, async (tx): Promise<ConsentPatchResult> => {
      const canStillAccessConsent = await canAccessCaseScopedPatientResource({
        db: tx,
        orgId: ctx.orgId,
        patientId: existing.patient_id,
        caseId: existing.case_id,
        accessContext: ctx,
      });
      if (!canStillAccessConsent) return { error: 'not_found' as const };

      const updateResult = await tx.consentRecord.updateMany({
        where: {
          id,
          org_id: ctx.orgId,
          updated_at: existing.updated_at,
        },
        data: updateData,
      });
      if (updateResult.count !== 1) {
        throw new ConsentPatchConflictError(
          '同意記録が他のユーザーによって更新されています。最新のデータを取得してください。',
        );
      }

      const record = await tx.consentRecord.findUnique({
        where: { id },
      });
      if (!record) return { error: 'not_found' as const };
      return { record };
    }).catch((error): ConsentPatchResult => {
      if (error instanceof ConsentPatchConflictError) {
        return { error: 'conflict', message: error.message };
      }
      throw error;
    });

    if ('error' in result) {
      if (result.error === 'conflict') {
        return conflict(result.message ?? '同意記録が他のユーザーによって更新されています');
      }
      return notFound('同意記録が見つかりません');
    }

    return success(result.record);
  },
  { permission: 'canVisit' },
);
