import { unstable_rethrow } from 'next/navigation';
import { NextRequest } from 'next/server';
import { batchResolveNames } from '@/lib/utils/name-resolver';
import { Prisma } from '@prisma/client';
import { requireAuthContext } from '@/lib/auth/context';
import { canAccessVisitScheduleAssignment } from '@/lib/auth/visit-schedule-access';
import { withOrgContext } from '@/lib/db/rls';
import { normalizeJsonInput, readJsonObject } from '@/lib/db/json';
import {
  conflict,
  forbiddenResponse,
  internalError,
  notFound,
  success,
  validationError,
} from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import {
  updateVisitRecordSchema,
  type VisitRecordAttachmentRefInput,
} from '@/lib/validations/visit-record';
import {
  getMissingHomeVisit2026CompletionItems,
  isHomeVisit2026CompletionOutcome,
} from '@/lib/visits/home-visit-2026-evidence';
import type { StructuredSoap } from '@/types/structured-soap';
import {
  getStoredFileRecord,
  toVisitRecordAttachment,
  type VisitRecordAttachment,
} from '@/server/services/file-storage';
import { getHomeVisitIntake, buildBaselineContext } from '@/lib/patient/home-visit-intake';
import { listBillingEvidenceBlockers } from '@/server/services/billing-evidence';
import {
  findMissingResidualMedicationDrugMasterIds,
  replaceVisitRecordResidualMedications,
  syncVisitRecordLabObservations,
} from '@/server/services/visit-record-derived-data';
import { validatePreviousVisitReuseSource } from '@/server/services/visit-record-source-validation';
import { normalizeStructuredSoapForVisitRecordSave } from '@/server/services/visit-handoff';

function normalizeInputJsonArray(value: unknown): Prisma.InputJsonArray {
  const normalized = normalizeJsonInput(value);
  return Array.isArray(normalized) ? normalized : [];
}

function parseStoredVisitRecordAttachments(value: unknown): VisitRecordAttachment[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((entry) => {
    const record = readJsonObject(entry);
    if (!record) return [];

    if (
      typeof record.file_id !== 'string' ||
      typeof record.file_name !== 'string' ||
      typeof record.mime_type !== 'string' ||
      typeof record.size_bytes !== 'number'
    ) {
      return [];
    }

    return [
      {
        file_id: record.file_id,
        file_name: record.file_name,
        mime_type: record.mime_type,
        size_bytes: record.size_bytes,
        uploaded_at: typeof record.uploaded_at === 'string' ? record.uploaded_at : null,
        kind: record.kind === 'attachment' ? 'attachment' : 'photo',
      } satisfies VisitRecordAttachment,
    ];
  });
}

const VISIT_RECORD_ATTACHMENT_VALIDATION_MESSAGE = '添付ファイル情報が不正です';

function validateVisitExecutionTimestamps(args: {
  visitStartedAt: Date | null;
  visitEndedAt: Date | null;
}) {
  if (args.visitEndedAt && !args.visitStartedAt) {
    return {
      field: 'visit_ended_at',
      message: '訪問終了時刻を記録するには訪問開始時刻が必要です',
    };
  }
  if (
    args.visitStartedAt &&
    args.visitEndedAt &&
    args.visitEndedAt.getTime() < args.visitStartedAt.getTime()
  ) {
    return {
      field: 'visit_ended_at',
      message: '訪問終了時刻は訪問開始時刻以降にしてください',
    };
  }

  return null;
}

async function resolveVisitRecordAttachments(
  orgId: string,
  recordId: string,
  attachments: VisitRecordAttachmentRefInput[],
) {
  const seen = new Set<string>();
  const resolved: VisitRecordAttachment[] = [];

  for (const attachment of attachments) {
    if (seen.has(attachment.file_id)) continue;
    seen.add(attachment.file_id);

    const file = await getStoredFileRecord(orgId, attachment.file_id);

    if (file.status !== 'uploaded') {
      throw new Error('アップロードが完了していない添付ファイルがあります');
    }

    if (file.purpose !== 'visit-photo') {
      throw new Error('訪問記録に紐づけできない添付ファイルが含まれています');
    }

    if (file.visitRecordId !== recordId) {
      throw new Error('添付ファイルの訪問記録IDが一致しません');
    }

    resolved.push(toVisitRecordAttachment(file));
  }

  return resolved;
}

async function authenticatedGET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '訪問記録の閲覧権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;

  const { id: rawId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return validationError('訪問記録IDが不正です');

  return withOrgContext(
    ctx.orgId,
    async (tx) => {
      const record = await tx.visitRecord.findFirst({
        where: { id, org_id: ctx.orgId },
        include: {
          schedule: {
            select: {
              id: true,
              case_id: true,
              site_id: true,
              pharmacist_id: true,
              visit_type: true,
              scheduled_date: true,
              recurrence_rule: true,
              time_window_start: true,
              time_window_end: true,
              case_: {
                select: {
                  primary_pharmacist_id: true,
                  backup_pharmacist_id: true,
                },
              },
            },
          },
        },
      });

      if (!record) return notFound('訪問記録が見つかりません');
      if (!canAccessVisitScheduleAssignment(ctx, record.schedule)) {
        return forbiddenResponse('この訪問記録を閲覧する権限がありません');
      }

      const caseId = record.schedule?.case_id ?? null;
      const patientId = record.patient_id;
      const [latestAudit, activeCase, patientSchedulePref] = await Promise.all([
        tx.auditLog.findFirst({
          where: {
            org_id: ctx.orgId,
            target_type: 'visit_record',
            target_id: id,
          },
          orderBy: { created_at: 'desc' },
          select: {
            actor_id: true,
          },
        }),
        caseId
          ? tx.careCase.findFirst({
              where: { id: caseId, org_id: ctx.orgId },
              select: { required_visit_support: true },
            })
          : Promise.resolve(null),
        tx.patientSchedulePreference.findFirst({
          where: { patient_id: patientId, org_id: ctx.orgId },
          select: { visit_before_contact_required: true },
        }),
      ]);

      const userIds = Array.from(
        new Set([record.pharmacist_id, latestAudit?.actor_id].filter(Boolean) as string[]),
      );
      const userById = await batchResolveNames(tx, ctx.orgId, userIds);

      const intakeData = getHomeVisitIntake(activeCase?.required_visit_support ?? null);
      const visitBeforeContactRequired = patientSchedulePref?.visit_before_contact_required ?? null;
      const baselineContext = buildBaselineContext(intakeData, visitBeforeContactRequired);

      const publicRecord = { ...record };
      delete (publicRecord as { patient_state_snapshot?: unknown }).patient_state_snapshot;
      delete (publicRecord as { visit_geo_log?: unknown }).visit_geo_log;

      return success({
        ...publicRecord,
        attachments: parseStoredVisitRecordAttachments(record.attachments),
        pharmacist_name: userById.get(record.pharmacist_id) ?? null,
        last_modified_by_id: latestAudit?.actor_id ?? record.pharmacist_id,
        last_modified_by_name:
          (latestAudit?.actor_id ? userById.get(latestAudit.actor_id) : null) ??
          userById.get(record.pharmacist_id) ??
          null,
        baseline_context: baselineContext,
      });
    },
    { requestContext: ctx },
  );
}

export async function GET(req: NextRequest, routeContext: { params: Promise<{ id: string }> }) {
  try {
    return withSensitiveNoStore(await authenticatedGET(req, routeContext));
  } catch (err) {
    unstable_rethrow(err);
    return withSensitiveNoStore(internalError());
  }
}

async function authenticatedPATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '訪問記録の更新権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;

  const { id: rawId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return validationError('訪問記録IDが不正です');

  const payload = await readJsonObjectRequestBody(req);
  if (!payload) return validationError('リクエストボディが不正です');
  if ('schedule_id' in payload || 'patient_id' in payload) {
    return validationError('訪問記録のスケジュールIDと患者IDは変更できません');
  }
  if ('carry_item_warning_acknowledged' in payload) {
    return validationError('持参物警告確認は訪問記録作成時のみ指定できます');
  }

  const parsed = updateVisitRecordSchema.safeParse(payload);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const {
    version,
    next_visit_suggestion_date,
    visit_date,
    visit_started_at,
    visit_ended_at,
    attachments,
    residual_medications,
    ...rest
  } = parsed.data;
  const updated = await withOrgContext(
    ctx.orgId,
    async (tx) => {
      // Optimistic lock: check version
      const existing = await tx.visitRecord.findFirst({
        where: { id, org_id: ctx.orgId },
        select: {
          id: true,
          version: true,
          patient_id: true,
          visit_date: true,
          visit_started_at: true,
          visit_ended_at: true,
          outcome_status: true,
          structured_soap: true,
          schedule: {
            select: {
              case_id: true,
              pharmacist_id: true,
              visit_type: true,
              case_: {
                select: {
                  primary_pharmacist_id: true,
                  backup_pharmacist_id: true,
                  required_visit_support: true,
                },
              },
            },
          },
        },
      });
      if (!existing) return null;
      if (!existing.schedule || !canAccessVisitScheduleAssignment(ctx, existing.schedule)) {
        return 'forbidden' as const;
      }
      const schedule = existing.schedule;
      if (existing.version !== version) return 'conflict' as const;

      const nextVisitStartedAt =
        visit_started_at !== undefined ? new Date(visit_started_at) : existing.visit_started_at;
      const nextVisitEndedAt =
        visit_ended_at !== undefined ? new Date(visit_ended_at) : existing.visit_ended_at;
      const visitExecutionTimestampError = validateVisitExecutionTimestamps({
        visitStartedAt: nextVisitStartedAt,
        visitEndedAt: nextVisitEndedAt,
      });
      if (visitExecutionTimestampError) {
        return {
          error: 'visit_execution_timestamp_validation' as const,
          field: visitExecutionTimestampError.field,
          message: visitExecutionTimestampError.message,
        };
      }

      const missingResidualMedicationDrugMasterIds =
        await findMissingResidualMedicationDrugMasterIds(tx, residual_medications);
      if (missingResidualMedicationDrugMasterIds.length > 0) {
        return {
          error: 'invalid_residual_medication_drug_master_id' as const,
        };
      }

      const normalizedStructuredSoap =
        rest.structured_soap !== undefined
          ? normalizeStructuredSoapForVisitRecordSave(
              rest.structured_soap,
              existing.structured_soap,
            )
          : undefined;

      const residualMedicationCount =
        residual_medications?.length ??
        (await tx.residualMedication.count({
          where: {
            org_id: ctx.orgId,
            visit_record_id: id,
          },
        }));
      const targetOutcome = rest.outcome_status ?? existing.outcome_status;
      let billingBlockers: Parameters<
        typeof getMissingHomeVisit2026CompletionItems
      >[0]['billingBlockers'] = [];
      if (isHomeVisit2026CompletionOutcome(targetOutcome)) {
        const [scopedVisitRecords, scopedMedicationCycles] = await Promise.all([
          tx.visitRecord.findMany({
            where: {
              org_id: ctx.orgId,
              patient_id: existing.patient_id,
              schedule: {
                case_id: schedule.case_id,
              },
            },
            select: { id: true },
          }),
          tx.medicationCycle.findMany({
            where: {
              org_id: ctx.orgId,
              patient_id: existing.patient_id,
              case_id: schedule.case_id,
            },
            select: { id: true },
          }),
        ]);
        const billingEvidence = await listBillingEvidenceBlockers(tx, {
          orgId: ctx.orgId,
          patientId: existing.patient_id,
          visitRecordIds: scopedVisitRecords.map((item) => item.id),
          cycleIds: scopedMedicationCycles.map((item) => item.id),
          limit: 4,
        });
        billingBlockers = billingEvidence.flatMap((item) => item.blockers);
      }
      const intakeInitialTransitionExpected =
        getHomeVisitIntake(schedule.case_.required_visit_support)
          ?.initial_transition_management_expected ?? null;
      const missingHomeVisit2026Items = getMissingHomeVisit2026CompletionItems({
        outcomeStatus: targetOutcome,
        structuredSoap:
          (normalizedStructuredSoap as Partial<StructuredSoap> | undefined) ??
          (existing.structured_soap as Partial<StructuredSoap> | null),
        visitType: schedule.visit_type ?? null,
        residualMedicationCount,
        billingBlockers,
        intakeInitialTransitionExpected,
      });
      if (missingHomeVisit2026Items.length > 0) {
        return {
          error: 'home_visit_2026_readiness_incomplete' as const,
          missingItems: missingHomeVisit2026Items.map((item) => item.label),
        };
      }

      if (normalizedStructuredSoap !== undefined) {
        const previousVisitReuseValidation = await validatePreviousVisitReuseSource({
          tx,
          orgId: ctx.orgId,
          patientId: existing.patient_id,
          caseId: schedule.case_id,
          structuredSoap: normalizedStructuredSoap,
        });
        if (!previousVisitReuseValidation.ok) {
          return {
            error: 'previous_visit_source_conflict' as const,
            reason: previousVisitReuseValidation.reason,
            details: previousVisitReuseValidation.details,
          };
        }
      }

      let normalizedAttachments: VisitRecordAttachment[] | undefined;
      if (attachments) {
        try {
          normalizedAttachments = await resolveVisitRecordAttachments(ctx.orgId, id, attachments);
        } catch {
          return {
            error: 'attachment_validation' as const,
            message: VISIT_RECORD_ATTACHMENT_VALIDATION_MESSAGE,
          };
        }
      }

      const updateResult = await tx.visitRecord.updateMany({
        where: { id, org_id: ctx.orgId, version },
        data: {
          ...rest,
          ...(visit_date ? { visit_date: new Date(visit_date) } : {}),
          ...(visit_started_at !== undefined
            ? { visit_started_at: new Date(visit_started_at) }
            : {}),
          ...(visit_ended_at !== undefined ? { visit_ended_at: new Date(visit_ended_at) } : {}),
          ...(next_visit_suggestion_date !== undefined
            ? {
                next_visit_suggestion_date:
                  next_visit_suggestion_date === '' ? null : new Date(next_visit_suggestion_date),
              }
            : {}),
          ...(rest.receipt_at !== undefined
            ? { receipt_at: rest.receipt_at === '' ? null : new Date(rest.receipt_at) }
            : {}),
          ...(normalizedStructuredSoap !== undefined
            ? { structured_soap: normalizeJsonInput(normalizedStructuredSoap) ?? Prisma.JsonNull }
            : {}),
          ...(normalizedAttachments
            ? { attachments: normalizeInputJsonArray(normalizedAttachments) }
            : {}),
          version: { increment: 1 },
        } as Prisma.VisitRecordUncheckedUpdateInput,
      });
      if (updateResult.count === 0) return 'conflict' as const;

      const record = await tx.visitRecord.findFirst({
        where: { id, org_id: ctx.orgId },
      });
      if (!record) return null;

      if (residual_medications !== undefined) {
        await replaceVisitRecordResidualMedications(tx, ctx.orgId, id, residual_medications);
      }

      if (normalizedStructuredSoap !== undefined) {
        await syncVisitRecordLabObservations(
          tx,
          ctx.orgId,
          existing.patient_id,
          id,
          visit_date ? new Date(visit_date) : existing.visit_date,
          normalizedStructuredSoap,
        );
      }

      return record;
    },
    { requestContext: ctx },
  );

  if (!updated) return notFound('訪問記録が見つかりません');
  if (updated === 'forbidden') {
    return forbiddenResponse('この訪問記録を更新する権限がありません');
  }
  if (updated === 'conflict') {
    return conflict(
      '他のユーザーによって更新されました。最新データを取得してから再試行してください',
    );
  }
  if ('error' in updated && updated.error === 'attachment_validation') {
    return validationError(updated.message);
  }
  if ('error' in updated && updated.error === 'invalid_residual_medication_drug_master_id') {
    return validationError('入力値が不正です', {
      drug_master_id: ['存在する医薬品マスターを選択してください'],
    });
  }
  if ('error' in updated && updated.error === 'visit_execution_timestamp_validation') {
    return validationError('入力値が不正です', {
      [updated.field]: [updated.message],
    });
  }
  if ('error' in updated && updated.error === 'home_visit_2026_readiness_incomplete') {
    return validationError('訪問完了には訪問薬剤管理の必須確認が必要です', {
      home_visit_2026_readiness: updated.missingItems,
    });
  }
  if ('error' in updated && updated.error === 'previous_visit_source_conflict') {
    return conflict(
      '前回訪問データが他のユーザーによって更新されています。訪問準備を再読み込みしてください。',
      {
        reason: updated.reason,
        source: updated.details,
      },
    );
  }

  return success(updated);
}

export async function PATCH(req: NextRequest, routeContext: { params: Promise<{ id: string }> }) {
  try {
    return withSensitiveNoStore(await authenticatedPATCH(req, routeContext));
  } catch (err) {
    unstable_rethrow(err);
    return withSensitiveNoStore(internalError());
  }
}
