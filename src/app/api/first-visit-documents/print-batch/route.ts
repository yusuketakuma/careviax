import { randomUUID } from 'crypto';
import { NextRequest } from 'next/server';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { withAuthContext, type AuthContext } from '@/lib/auth/context';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { conflict, notFound, success, validationError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { withOrgContext } from '@/lib/db/rls';
import { readJsonObject } from '@/lib/db/json';
import { isPrismaErrorCode } from '@/lib/db/prisma-errors';
import { recordFirstVisitDocumentPrintBatchSchema } from '@/lib/validations/first-visit-document';
import { canAccessCareCase } from '@/server/services/patient-access';
import { getPatientDocumentsData } from '@/server/services/patient-detail-documents';
import { requireWritablePatient } from '@/server/services/patient-write-guard';
import {
  claimFirstVisitDocumentVersion,
  FIRST_VISIT_DOCUMENT_VERSION_CONFLICT_REASON,
  FirstVisitDocumentVersionConflictError,
} from '@/server/services/first-visit-document-version';
import type { Prisma } from '@prisma/client';

type FirstVisitPrintBatchResult =
  | { data: { print_batch_id: string; printed_document_ids: string[]; document_count: number } }
  | { response: Response }
  | { error: 'not_found' | 'conflict' | 'print_blocked'; message?: string };

function buildServerPrintBatchId(now = new Date()) {
  return `print_${now.toISOString().replace(/[^0-9A-Za-z]/g, '')}_${randomUUID()
    .replace(/-/g, '')
    .slice(0, 12)}`;
}

function buildFirstVisitPrintCopyUrl({
  patientId,
  documentId,
}: {
  patientId: string;
  documentId: string;
}) {
  const params = new URLSearchParams({
    type: 'first_visit_documents',
    patient_id: patientId,
    document_id: documentId,
    copy: '1',
  });
  return `/reports/print?${params.toString()}`;
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

function latestDocumentActionByTargetId(
  auditLogs: Array<{ target_id: string; changes: Prisma.JsonValue | null }>,
) {
  const latest = new Map<string, Record<string, unknown>>();
  for (const log of auditLogs) {
    if (latest.has(log.target_id)) continue;
    const changes = readJsonObject(log.changes);
    const documentAction = readJsonObject(changes?.document_action);
    if (documentAction) latest.set(log.target_id, documentAction);
  }
  return latest;
}

async function firstVisitDocumentPrintBatchPOST(req: NextRequest, ctx: AuthContext) {
  const payload = await readJsonObjectRequestBody(req);
  if (!payload) return validationError('リクエストボディが不正です');

  const parsed = recordFirstVisitDocumentPrintBatchSchema.safeParse(payload);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const requestedDocuments = [...parsed.data.documents].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  const documentIds = requestedDocuments.map((document) => document.id);
  const expectedVersionById = new Map(
    requestedDocuments.map((document) => [document.id, new Date(document.expected_updated_at)]),
  );

  const result = await withOrgContext(
    ctx.orgId,
    async (tx): Promise<FirstVisitPrintBatchResult> => {
      const documents = await tx.firstVisitDocument.findMany({
        where: {
          id: { in: documentIds },
          org_id: ctx.orgId,
          patient_id: parsed.data.patient_id,
        },
        orderBy: [{ id: 'asc' }],
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

      if (documents.length !== documentIds.length) {
        return { error: 'not_found' };
      }

      for (const document of documents) {
        const canAccessScope = await canAccessCareCase({
          db: tx,
          orgId: ctx.orgId,
          patientId: document.patient_id,
          caseId: document.case_id,
          accessContext: ctx,
        });
        if (!canAccessScope) return { error: 'not_found' };
      }

      const writable = await requireWritablePatient(tx, ctx, parsed.data.patient_id);
      if ('response' in writable) return { response: writable.response };

      const documentsData = await getPatientDocumentsData(tx, {
        orgId: ctx.orgId,
        patientId: parsed.data.patient_id,
        role: ctx.role,
        userId: ctx.userId,
      });
      if (!documentsData) return { error: 'not_found' };

      const readiness = documentsData.print_readiness;
      if (readiness.overall_status === 'blocked' || readiness.missing_required_count > 0) {
        return { error: 'print_blocked', message: buildPrintBlockedMessage(readiness) };
      }

      const latestAuditLogs = await tx.auditLog.findMany({
        where: {
          org_id: ctx.orgId,
          target_type: 'first_visit_document',
          target_id: { in: documentIds },
          action: { startsWith: 'first_visit_document.' },
        },
        orderBy: [{ created_at: 'desc' }],
        take: documentIds.length * 10,
        select: {
          target_id: true,
          changes: true,
        },
      });
      const latestActionByDocumentId = latestDocumentActionByTargetId(latestAuditLogs);
      const printBatchId = buildServerPrintBatchId();

      const claimedVersions = new Map<string, Date>();
      for (const document of documents) {
        const expectedUpdatedAt = expectedVersionById.get(document.id);
        if (!expectedUpdatedAt) throw new FirstVisitDocumentVersionConflictError();
        const documentUrl = parsed.data.save_copy
          ? buildFirstVisitPrintCopyUrl({
              patientId: parsed.data.patient_id,
              documentId: document.id,
            })
          : document.document_url;
        const updatedAt = await claimFirstVisitDocumentVersion(tx, {
          id: document.id,
          orgId: ctx.orgId,
          expectedUpdatedAt,
          data: parsed.data.save_copy ? { document_url: documentUrl } : {},
        });
        claimedVersions.set(document.id, updatedAt);
      }

      for (const document of documents) {
        const documentUrl = parsed.data.save_copy
          ? buildFirstVisitPrintCopyUrl({
              patientId: parsed.data.patient_id,
              documentId: document.id,
            })
          : document.document_url;
        const latestAction = latestActionByDocumentId.get(document.id);
        await createAuditLogEntry(tx, ctx, {
          action: 'first_visit_document.printed',
          targetType: 'first_visit_document',
          targetId: document.id,
          changes: {
            document_action: {
              action: 'printed',
              document_type:
                typeof latestAction?.document_type === 'string'
                  ? latestAction.document_type
                  : 'first_visit_document',
              template_name:
                typeof latestAction?.template_name === 'string'
                  ? latestAction.template_name
                  : '契約・同意控え',
              template_version:
                typeof latestAction?.template_version === 'string'
                  ? latestAction.template_version
                  : 'print-preview',
              print_batch_id: printBatchId,
              storage_location:
                typeof latestAction?.storage_location === 'string'
                  ? latestAction.storage_location
                  : null,
              note: parsed.data.save_copy
                ? '印刷ハブから一括印刷し、控えリンクを保存'
                : '印刷ハブから一括印刷',
            },
            patient_id: document.patient_id,
            case_id: document.case_id,
            previous: {
              document_url: document.document_url,
              delivered_at: document.delivered_at?.toISOString() ?? null,
              delivered_to: document.delivered_to,
            },
            next: {
              document_url: documentUrl,
              delivered_at: document.delivered_at?.toISOString() ?? null,
              delivered_to: document.delivered_to,
              updated_at: claimedVersions.get(document.id)?.toISOString() ?? null,
            },
          },
        });
      }

      return {
        data: {
          print_batch_id: printBatchId,
          printed_document_ids: documents.map((document) => document.id),
          document_count: documents.length,
        },
      };
    },
    { requestContext: ctx, timeoutMs: 10_000, maxWaitMs: 2_000 },
  ).catch((error): FirstVisitPrintBatchResult => {
    if (
      error instanceof FirstVisitDocumentVersionConflictError ||
      isPrismaErrorCode(error, 'P2034')
    ) {
      return {
        error: 'conflict',
        message: '初回文書が他のユーザーによって更新されています。最新のデータを取得してください。',
      };
    }
    throw error;
  });

  if ('response' in result) return result.response;

  if ('error' in result) {
    if (result.error === 'conflict') {
      return conflict(result.message ?? '初回文書が他のユーザーによって更新されています', {
        reason: FIRST_VISIT_DOCUMENT_VERSION_CONFLICT_REASON,
      });
    }
    if (result.error === 'print_blocked') {
      return conflict(result.message ?? '初回文書の印刷前チェックが未完了です');
    }
    return notFound('印刷対象の初回文書が見つかりません');
  }

  return withSensitiveNoStore(success({ data: result.data }));
}

export const POST = withAuthContext(firstVisitDocumentPrintBatchPOST, {
  permission: 'canVisit',
  message: '初回文書の印刷権限がありません',
});
