import { randomUUID } from 'crypto';
import { NextRequest } from 'next/server';
import { withAuthContext } from '@/lib/auth/context';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { conflict, notFound, success, validationError } from '@/lib/api/response';
import { withOrgContext } from '@/lib/db/rls';
import { readJsonObject } from '@/lib/db/json';
import { recordFirstVisitDocumentPrintBatchSchema } from '@/lib/validations/first-visit-document';
import { canAccessCareCase } from '@/server/services/patient-access';
import { getPatientDocumentsData } from '@/server/services/patient-detail-documents';
import type { Prisma } from '@prisma/client';

type FirstVisitPrintBatchResult =
  | { data: { print_batch_id: string; printed_document_ids: string[]; document_count: number } }
  | { error: 'not_found' | 'conflict' | 'print_blocked'; message?: string };

class FirstVisitPrintBatchConflictError extends Error {}

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

export const POST = withAuthContext(
  async (req: NextRequest, ctx) => {
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = recordFirstVisitDocumentPrintBatchSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const documentIds = [...new Set(parsed.data.document_ids)];

    const result = await withOrgContext(
      ctx.orgId,
      async (tx): Promise<FirstVisitPrintBatchResult> => {
        const documents = await tx.firstVisitDocument.findMany({
          where: {
            id: { in: documentIds },
            org_id: ctx.orgId,
            patient_id: parsed.data.patient_id,
          },
          orderBy: [{ created_at: 'asc' }],
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

        for (const document of documents) {
          const documentUrl = parsed.data.save_copy
            ? buildFirstVisitPrintCopyUrl({
                patientId: parsed.data.patient_id,
                documentId: document.id,
              })
            : document.document_url;
          if (parsed.data.save_copy && document.document_url !== documentUrl) {
            const updateResult = await tx.firstVisitDocument.updateMany({
              where: {
                id: document.id,
                org_id: ctx.orgId,
                updated_at: document.updated_at,
              },
              data: { document_url: documentUrl },
            });
            if (updateResult.count !== 1) {
              throw new FirstVisitPrintBatchConflictError(
                '初回文書が他のユーザーによって更新されています。最新のデータを取得してください。',
              );
            }
          }

          const latestAction = latestActionByDocumentId.get(document.id);
          await tx.auditLog.create({
            data: {
              org_id: ctx.orgId,
              actor_id: ctx.userId,
              action: 'first_visit_document.printed',
              target_type: 'first_visit_document',
              target_id: document.id,
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
                },
              },
              ip_address: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
              user_agent: req.headers.get('user-agent'),
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
    ).catch((error): FirstVisitPrintBatchResult => {
      if (error instanceof FirstVisitPrintBatchConflictError) {
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
      return notFound('印刷対象の初回文書が見つかりません');
    }

    return success({ data: result.data });
  },
  {
    permission: 'canVisit',
    message: '初回文書の印刷権限がありません',
  },
);
