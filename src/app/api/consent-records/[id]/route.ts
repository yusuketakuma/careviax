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
import {
  buildAuditedConsentDocumentUrl,
  CONSENT_DOCUMENT_MIME_TYPES,
  normalizeAuditedConsentDocumentUrl,
  serializeConsentRecordDocumentUrl,
} from '@/server/services/consent-record-documents';
import {
  recordConsentRecordUpdatedAudit,
  recordConsentRecordViewedAudit,
} from '@/server/services/consent-record-audit';
import type { ConsentRecord } from '@prisma/client';

function optionalTrimmedString(value: unknown) {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

const updateConsentSchema = z.object({
  expiry_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .nullable(),
  document_url: z.preprocess(optionalTrimmedString, z.string().max(500).optional().nullable()),
  document_file_id: z.preprocess(optionalTrimmedString, z.string().min(1).optional()),
});

type ConsentPatchResult =
  | { record: ConsentRecord }
  | { error: 'not_found' | 'conflict'; message?: string };

class ConsentPatchConflictError extends Error {}

async function validateConsentDocumentFileAsset(args: {
  orgId: string;
  patientId: string;
  fileId: string;
}) {
  return prisma.fileAsset.findFirst({
    where: {
      id: args.fileId,
      org_id: args.orgId,
      purpose: 'consent-document',
      status: 'uploaded',
      mime_type: { in: CONSENT_DOCUMENT_MIME_TYPES },
      patient_id: args.patientId,
    },
    select: { id: true },
  });
}

function resolveConsentDocumentUrlInput(args: {
  documentUrl?: string | null;
  documentFileId?: string;
}) {
  if (args.documentUrl !== undefined && args.documentFileId) {
    return {
      ok: false as const,
      response: validationError('入力値が不正です', {
        document_url: ['document_url と document_file_id は同時に指定できません'],
      }),
    };
  }

  if (args.documentFileId) {
    return { ok: true as const, documentUrl: buildAuditedConsentDocumentUrl(args.documentFileId) };
  }

  if (args.documentUrl === undefined) {
    return { ok: true as const, documentUrl: undefined };
  }

  if (args.documentUrl === null) {
    return { ok: true as const, documentUrl: null };
  }

  const normalizedUrl = normalizeAuditedConsentDocumentUrl(args.documentUrl);
  if (!normalizedUrl) {
    return {
      ok: false as const,
      response: validationError('入力値が不正です', {
        document_url: ['同意書文書は監査済みファイルURLまたは document_file_id で指定してください'],
      }),
    };
  }

  return { ok: true as const, documentUrl: normalizedUrl };
}

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

    await recordConsentRecordViewedAudit(prisma, ctx, visibleRecord);

    return success(serializeConsentRecordDocumentUrl(visibleRecord));
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
      select: {
        id: true,
        patient_id: true,
        case_id: true,
        consent_type: true,
        method: true,
        is_active: true,
        expiry_date: true,
        document_url: true,
        template_id: true,
        template_version: true,
        updated_at: true,
      },
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

    const { expiry_date, document_url, document_file_id } = parsed.data;
    const documentInput = resolveConsentDocumentUrlInput({
      documentUrl: document_url,
      documentFileId: document_file_id,
    });
    if (!documentInput.ok) return documentInput.response;

    if (document_file_id) {
      const fileAsset = await validateConsentDocumentFileAsset({
        orgId: ctx.orgId,
        patientId: existing.patient_id,
        fileId: document_file_id,
      });
      if (!fileAsset) {
        return validationError('入力値が不正です', {
          document_file_id: ['患者に紐づくアップロード済み同意書ファイルではありません'],
        });
      }
    }

    const updateData = {
      ...(expiry_date !== undefined
        ? { expiry_date: expiry_date ? new Date(expiry_date) : null }
        : {}),
      ...(documentInput.documentUrl !== undefined
        ? { document_url: documentInput.documentUrl }
        : {}),
    };
    const changedFields = [
      ...(expiry_date !== undefined ? ['expiry_date'] : []),
      ...(documentInput.documentUrl !== undefined ? ['document_url'] : []),
    ];

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
      await recordConsentRecordUpdatedAudit(tx, ctx, {
        before: existing,
        after: record,
        changedFields,
      });
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

    return success(serializeConsentRecordDocumentUrl(result.record));
  },
  { permission: 'canVisit' },
);
