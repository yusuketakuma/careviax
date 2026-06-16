import { NextRequest } from 'next/server';
import { withAuthContext, type AuthRouteContext } from '@/lib/auth/context';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { conflict, notFound, success, validationError } from '@/lib/api/response';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { prisma } from '@/lib/db/client';
import { withOrgContext } from '@/lib/db/rls';
import { updateFirstVisitDocumentSchema } from '@/lib/validations/first-visit-document';
import { canAccessCareCase } from '@/server/services/patient-access';
import { getPatientDocumentsData } from '@/server/services/patient-detail-documents';
import type { FirstVisitDocument } from '@prisma/client';

type FirstVisitDocumentPatchResult =
  | { document: FirstVisitDocument }
  | { error: 'not_found' | 'conflict' | 'print_blocked'; message?: string };

class FirstVisitDocumentPatchConflictError extends Error {}

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

export const PATCH = withAuthContext<{ id: string }>(
  async (req: NextRequest, ctx, routeContext: AuthRouteContext<{ id: string }>) => {
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

        if (parsed.data.document_action) {
          await tx.auditLog.create({
            data: {
              org_id: ctx.orgId,
              actor_id: ctx.userId,
              action: `first_visit_document.${parsed.data.document_action.action}`,
              target_type: 'first_visit_document',
              target_id: id,
              changes: {
                document_action: parsed.data.document_action,
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
              ip_address: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
              user_agent: req.headers.get('user-agent'),
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

    return success({ data: result.document });
  },
  {
    permission: 'canVisit',
    message: '初回文書の更新権限がありません',
  },
);
