import { NextRequest } from 'next/server';
import { unstable_rethrow } from 'next/navigation';
import { randomUUID } from 'crypto';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { requireAuthContext, type AuthRouteContext } from '@/lib/auth/context';
import { runWithRequestAuthContext } from '@/lib/auth/request-context';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { conflict, internalError, notFound, success, validationError } from '@/lib/api/response';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { prisma } from '@/lib/db/client';
import { withOrgContext } from '@/lib/db/rls';
import { updateFirstVisitDocumentSchema } from '@/lib/validations/first-visit-document';
import { canAccessCareCase } from '@/server/services/patient-access';
import { getPatientDocumentsData } from '@/server/services/patient-detail-documents';
import { requireWritablePatient } from '@/server/services/patient-write-guard';
import type { FirstVisitDocument } from '@prisma/client';
import { toSafeFirstVisitDocumentMutationResponse } from '../response';
import { logger } from '@/lib/utils/logger';
import { withRoutePerformance } from '@/lib/utils/performance';

const ROUTE = '/api/first-visit-documents/[id]';
const SAFE_ERROR_NAMES = new Set([
  'Error',
  'TypeError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'EvalError',
  'URIError',
]);

function safeErrorName(err: unknown): string {
  if (!(err instanceof Error)) return 'Error';
  return SAFE_ERROR_NAMES.has(err.name) ? err.name : 'Error';
}

type FirstVisitDocumentPatchResult =
  | { document: FirstVisitDocument }
  | { error: 'not_found' | 'conflict' | 'print_blocked'; message?: string };

class FirstVisitDocumentPatchConflictError extends Error {}

function buildServerPrintBatchId(now = new Date()) {
  return `print_${now.toISOString().replace(/[^0-9A-Za-z]/g, '')}_${randomUUID()
    .replace(/-/g, '')
    .slice(0, 12)}`;
}

function buildPrintBlockedMessage(
  readiness: NonNullable<Awaited<ReturnType<typeof getPatientDocumentsData>>>['print_readiness'],
) {
  const missingRequiredLabels = readiness.checks
    .filter((check) => check.severity === 'required' && !check.completed)
    .map((check) => check.label);
  const reason =
    missingRequiredLabels.length > 0
      ? `不足: ${missingRequiredLabels.join('、')}`
      : '必須項目に不足があります';
  return `初回文書の印刷前チェックで必須項目が未完了です。${reason}`;
}

function validateDocumentActionRequirements(args: {
  action: string | undefined;
  nextDocumentUrl: string | null;
  nextDeliveredAt: Date | null;
  nextDeliveredTo: string | null;
}) {
  const details: Record<string, string[]> = {};

  if (['image_saved', 'replaced'].includes(args.action ?? '') && !args.nextDocumentUrl?.trim()) {
    details.document_url = ['画像保存・差替えでは署名済み書類のURLを入力してください'];
  }

  if (args.action === 'recovered') {
    if (!args.nextDeliveredAt) {
      details.delivered_at = ['回収では回収日時を入力してください'];
    }
    if (!args.nextDeliveredTo?.trim()) {
      details.delivered_to = ['回収では同意者・交付先を入力してください'];
    }
  }

  return details;
}

async function authenticatedPATCH(
  req: NextRequest,
  routeContext: AuthRouteContext<{ id: string }>,
) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '初回文書の更新権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  return runWithRequestAuthContext(ctx, async () => {
    const { id: rawId } = await routeContext.params;
    const id = normalizeRequiredRouteParam(rawId);
    if (!id) return validationError('初回文書IDが不正です');

    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = updateFirstVisitDocumentSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const existing = await prisma.firstVisitDocument.findFirst({
      where: { id, org_id: ctx.orgId },
      select: {
        id: true,
        patient_id: true,
        case_id: true,
        document_url: true,
        delivered_at: true,
        delivered_to: true,
        updated_at: true,
      },
    });
    if (!existing) return notFound('初回文書が見つかりません');

    const canAccessScope = await canAccessCareCase({
      db: prisma,
      orgId: ctx.orgId,
      patientId: existing.patient_id,
      caseId: existing.case_id,
      accessContext: ctx,
    });
    if (!canAccessScope) return notFound('初回文書が見つかりません');

    const writable = await requireWritablePatient(prisma, ctx, existing.patient_id);
    if ('response' in writable) {
      return writable.response ?? conflict('アーカイブ中の患者は復元するまで更新できません');
    }

    const updateData = {
      ...(parsed.data.delivered_at !== undefined
        ? { delivered_at: parsed.data.delivered_at ? new Date(parsed.data.delivered_at) : null }
        : {}),
      ...(parsed.data.delivered_to !== undefined ? { delivered_to: parsed.data.delivered_to } : {}),
      ...(parsed.data.emergency_contacts !== undefined
        ? { emergency_contacts: parsed.data.emergency_contacts }
        : {}),
      ...(parsed.data.document_url !== undefined ? { document_url: parsed.data.document_url } : {}),
    };
    const hasDocumentUpdate = Object.keys(updateData).length > 0;
    const nextDocumentUrl =
      parsed.data.document_url !== undefined ? parsed.data.document_url : existing.document_url;
    const nextDeliveredAt =
      parsed.data.delivered_at !== undefined
        ? parsed.data.delivered_at
          ? new Date(parsed.data.delivered_at)
          : null
        : existing.delivered_at;
    const nextDeliveredTo =
      parsed.data.delivered_to !== undefined ? parsed.data.delivered_to : existing.delivered_to;
    const requirementErrors = validateDocumentActionRequirements({
      action: parsed.data.document_action?.action,
      nextDocumentUrl,
      nextDeliveredAt,
      nextDeliveredTo,
    });
    if (Object.keys(requirementErrors).length > 0) {
      return validationError('入力値が不正です', requirementErrors);
    }

    const result = await withOrgContext(
      ctx.orgId,
      async (tx): Promise<FirstVisitDocumentPatchResult> => {
        const canStillAccessScope = await canAccessCareCase({
          db: tx,
          orgId: ctx.orgId,
          patientId: existing.patient_id,
          caseId: existing.case_id,
          accessContext: ctx,
        });
        if (!canStillAccessScope) return { error: 'not_found' };

        if (parsed.data.document_action?.action === 'printed') {
          const documentsData = await getPatientDocumentsData(tx, {
            orgId: ctx.orgId,
            patientId: existing.patient_id,
            role: ctx.role,
            userId: ctx.userId,
          });
          if (!documentsData) return { error: 'not_found' };

          const readiness = documentsData.print_readiness;
          if (readiness.overall_status === 'blocked' || readiness.missing_required_count > 0) {
            return { error: 'print_blocked', message: buildPrintBlockedMessage(readiness) };
          }
        }

        if (hasDocumentUpdate) {
          const updateResult = await tx.firstVisitDocument.updateMany({
            where: {
              id,
              org_id: ctx.orgId,
              updated_at: existing.updated_at,
            },
            data: updateData,
          });
          if (updateResult.count !== 1) {
            throw new FirstVisitDocumentPatchConflictError(
              '初回文書が他のユーザーによって更新されています。最新のデータを取得してください。',
            );
          }
        }

        const document = await tx.firstVisitDocument.findUnique({
          where: { id },
        });
        if (!document) return { error: 'not_found' };

        if (parsed.data.document_action) {
          const documentAction =
            parsed.data.document_action.action === 'printed'
              ? {
                  ...parsed.data.document_action,
                  print_batch_id: buildServerPrintBatchId(),
                }
              : parsed.data.document_action;
          await createAuditLogEntry(tx, ctx, {
            action: `first_visit_document.${documentAction.action}`,
            targetType: 'first_visit_document',
            targetId: id,
            changes: {
              document_action: documentAction,
              patient_id: existing.patient_id,
              case_id: existing.case_id,
              previous: {
                document_url: existing.document_url,
                delivered_at: existing.delivered_at?.toISOString() ?? null,
                delivered_to: existing.delivered_to,
              },
              next: {
                document_url: document.document_url,
                delivered_at: document.delivered_at?.toISOString() ?? null,
                delivered_to: document.delivered_to,
              },
            },
          });
        }

        return { document };
      },
    ).catch((error): FirstVisitDocumentPatchResult => {
      if (error instanceof FirstVisitDocumentPatchConflictError) {
        return { error: 'conflict', message: error.message };
      }
      throw error;
    });

    if ('error' in result) {
      if (result.error === 'conflict') {
        return conflict(result.message ?? '初回文書が他のユーザーによって更新されています');
      }
      if (result.error === 'print_blocked') {
        return conflict(result.message ?? '初回文書の印刷前チェックが未完了です');
      }
      return notFound('初回文書が見つかりません');
    }

    return success({ data: toSafeFirstVisitDocumentMutationResponse(result.document) });
  });
}

export async function PATCH(req: NextRequest, routeContext: AuthRouteContext<{ id: string }>) {
  return withRoutePerformance(req, async () => {
    try {
      return withSensitiveNoStore(await authenticatedPATCH(req, routeContext));
    } catch (err) {
      unstable_rethrow(err);
      logger.error('first_visit_documents_id_patch_unhandled_error', undefined, {
        event: 'first_visit_documents_id_patch_unhandled_error',
        route: ROUTE,
        method: req.method,
        status: 500,
        error_name: safeErrorName(err),
      });
      return withSensitiveNoStore(internalError());
    }
  });
}
