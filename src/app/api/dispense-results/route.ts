import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { buildAuditTaskHref } from '@/lib/audit/navigation';
import { NextRequest } from 'next/server';
import { unstable_rethrow } from 'next/navigation';
import { requireAuthContext } from '@/lib/auth/context';
import { ADMIN_MEMBER_ROLES } from '@/lib/auth/member-roles';
import { withOrgContext } from '@/lib/db/rls';
import { runWithRequestAuthContext } from '@/lib/auth/request-context';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { success, validationError, notFound, conflict, internalError } from '@/lib/api/response';
import { dispatchNotificationEvent } from '@/server/services/notifications';
import { notifyWebhookEventForOrg } from '@/server/services/outbound-webhook';
import { notifyWorkflowMutation } from '@/server/services/workflow-dashboard-cache';
import { upsertOperationalTask } from '@/server/services/operational-tasks';
import { checkDispenseAlerts } from '@/server/cds/checker';
import { buildMedicationCycleAssignmentWhere } from '@/server/services/prescription-access';
import {
  transitionCycleStatus,
  InvalidTransitionError,
  VersionConflictError,
} from '@/lib/db/cycle-transition';
import { DISPENSE_SAFETY_CHECKLIST_ACK } from '@/lib/dispensing/safety-checklist';
import {
  buildActualQuantityConfirmationErrors,
  buildActualQuantityUnitErrors,
  buildDiscrepancyReasonErrors,
  buildUnresolvedPrescribedQuantityErrors,
  resolveCanonicalActualUnit,
} from '@/lib/dispensing/dispense-result-validation';
import {
  verifyDispenseBarcodeForLine,
  type DispenseBarcodeVerificationEvidence,
} from '@/lib/dispensing/dispense-barcode-verification';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import type { ExceptionSeverity, ExceptionStatus } from '@/types/domain-literals';
import { logger } from '@/lib/utils/logger';
import { withRoutePerformance } from '@/lib/utils/performance';

const dispenseResultLineSchema = z.object({
  line_id: z.string().min(1),
  actual_drug_name: z.string().min(1, '実薬剤名は必須です'),
  actual_drug_code: z.string().optional(),
  actual_quantity: z.number().positive('数量は正の数を入力してください'),
  actual_quantity_confirmed: z.boolean().optional(),
  actual_quantity_source: z
    .enum(['existing_result', 'prescription_quantity_confirmed', 'manual_entry'])
    .optional(),
  actual_unit: z.string().optional(),
  discrepancy_reason: z.string().optional(),
  carry_type: z.enum(['carry', 'facility_deposit', 'deferred']),
  special_notes: z.string().optional(),
  is_unit_dose: z.boolean().optional(),
  is_crushed: z.boolean().optional(),
  packaging_method: z
    .enum([
      'none',
      'unit_dose',
      'morning_evening_unit_dose',
      'medication_box',
      'calendar_pack',
      'blister_pack',
      'crush_and_pack',
      'other',
    ])
    .optional(),
  packaging_group_id: z.string().optional(),
  barcode_scan: z
    .object({
      barcode: z.string().trim().min(1, 'バーコードは必須です').max(512),
    })
    .strict()
    .optional(),
});

const dispenseSafetyChecklistSchema = z.object({
  patient_identity: z.literal(DISPENSE_SAFETY_CHECKLIST_ACK.patient_identity),
  drug_name_strength: z.literal(DISPENSE_SAFETY_CHECKLIST_ACK.drug_name_strength),
  quantity_days: z.literal(DISPENSE_SAFETY_CHECKLIST_ACK.quantity_days),
  directions_route: z.literal(DISPENSE_SAFETY_CHECKLIST_ACK.directions_route),
  packaging_storage: z.literal(DISPENSE_SAFETY_CHECKLIST_ACK.packaging_storage),
  cds_alerts_reviewed: z.literal(DISPENSE_SAFETY_CHECKLIST_ACK.cds_alerts_reviewed),
});

const createDispenseResultSchema = z.object({
  task_id: z.string().min(1),
  lines: z.array(dispenseResultLineSchema).min(1, '調剤実績を1件以上入力してください'),
  safety_checklist: dispenseSafetyChecklistSchema.optional(),
  // 楽観的ロック: ワークベンチ表示時の cycle.version。
  // 調剤結果は訪問 carry_items まで再投影するため、必ず現在 version と照合する。
  expected_version: z.number().int().nonnegative(),
});

type SubmittedDispenseResultLine = z.infer<typeof dispenseResultLineSchema>;

const ROUTE = '/api/dispense-results';
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

type ReplayableDispenseResult = {
  id: string;
  line_id: string;
  actual_drug_name: string;
  actual_drug_code: string | null;
  actual_quantity: unknown;
  actual_unit: string | null;
  discrepancy_reason: string | null;
  carry_type: string | null;
  special_notes: string | null;
};

type ReplayablePrescriptionLine = {
  id: string;
  drug_name: string;
  drug_code: string | null;
  unit: string | null;
};

function resolveCarryItemsStatus(lines: Array<{ carry_type: string | null | undefined }>) {
  const hasDeferred = lines.some((line) => line.carry_type === 'deferred');
  const hasReadyItem = lines.some(
    (line) => line.carry_type === 'carry' || line.carry_type === 'facility_deposit',
  );

  if (!hasDeferred) return 'ready' as const;
  if (hasReadyItem) return 'partial' as const;
  return 'blocked' as const;
}

function countCdsAlertsBySeverity(alerts: Array<{ severity: 'critical' | 'warning' | 'info' }>) {
  return alerts.reduce(
    (counts, alert) => {
      counts[alert.severity] += 1;
      return counts;
    },
    { critical: 0, warning: 0, info: 0 },
  );
}

function resolveDispensingDecision(line: z.infer<typeof dispenseResultLineSchema>) {
  const method =
    line.packaging_method ??
    (line.is_unit_dose ? 'unit_dose' : line.is_crushed ? 'crush_and_pack' : null);
  const groupId = line.packaging_group_id?.trim() || null;

  if (!method && !groupId) return null;

  return {
    dispensing_method:
      method === 'crush_and_pack'
        ? 'crushed'
        : method === 'none'
          ? 'standard'
          : method === 'other'
            ? 'other'
            : 'unit_dose',
    packaging_method: method ?? 'none',
    packaging_instructions: line.special_notes?.trim() || null,
    packaging_group_id: groupId,
  };
}

async function findInvalidPackagingGroupAssignments(args: {
  tx: Prisma.TransactionClient;
  orgId: string;
  cycleId: string;
  lines: Array<SubmittedDispenseResultLine>;
}) {
  const requestedGroupIds = Array.from(
    new Set(
      args.lines
        .map((line) => line.packaging_group_id?.trim())
        .filter((groupId): groupId is string => Boolean(groupId)),
    ),
  );
  if (requestedGroupIds.length === 0) return [];

  const groups = await args.tx.packagingGroup.findMany({
    where: {
      org_id: args.orgId,
      cycle_id: args.cycleId,
      id: { in: requestedGroupIds },
    },
    select: { id: true },
  });
  const validGroupIds = new Set(groups.map((group) => group.id));

  return args.lines.flatMap((line) => {
    const groupId = line.packaging_group_id?.trim();
    if (!groupId || validGroupIds.has(groupId)) return [];
    return [{ line_id: line.line_id, packaging_group_id: groupId }];
  });
}

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

function normalizeOptionalText(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function actualDrugIdentityMatches(args: {
  existingResult: Pick<ReplayableDispenseResult, 'actual_drug_name' | 'actual_drug_code'>;
  submittedLine: Pick<SubmittedDispenseResultLine, 'actual_drug_name' | 'actual_drug_code'>;
}) {
  const existingCode = normalizeOptionalText(args.existingResult.actual_drug_code);
  const submittedCode = normalizeOptionalText(args.submittedLine.actual_drug_code);
  if (existingCode || submittedCode) return existingCode != null && existingCode === submittedCode;

  return args.existingResult.actual_drug_name === args.submittedLine.actual_drug_name;
}

function dispenseResultMatchesSubmittedLine(args: {
  existingResult: ReplayableDispenseResult;
  submittedLine: SubmittedDispenseResultLine;
  prescribedUnit: string | null | undefined;
}) {
  const canonicalActualUnit = resolveCanonicalActualUnit({
    prescribedUnit: args.prescribedUnit,
    actualUnit: args.submittedLine.actual_unit,
  });

  return (
    actualDrugIdentityMatches(args) &&
    Number(args.existingResult.actual_quantity) === args.submittedLine.actual_quantity &&
    normalizeOptionalText(args.existingResult.actual_unit) ===
      normalizeOptionalText(canonicalActualUnit) &&
    normalizeOptionalText(args.existingResult.discrepancy_reason) ===
      normalizeOptionalText(args.submittedLine.discrepancy_reason) &&
    args.existingResult.carry_type === args.submittedLine.carry_type &&
    normalizeOptionalText(args.existingResult.special_notes) ===
      normalizeOptionalText(args.submittedLine.special_notes)
  );
}

async function buildIdempotentDispenseResultReplay(args: {
  tx: Prisma.TransactionClient;
  taskId: string;
  submittedLines: Array<SubmittedDispenseResultLine>;
  prescribedLines: Array<ReplayablePrescriptionLine>;
  existingResults: Array<ReplayableDispenseResult>;
}) {
  const prescribedLineById = new Map(args.prescribedLines.map((line) => [line.id, line]));
  const existingResultByLineId = new Map(
    args.existingResults.map((result) => [result.line_id, result]),
  );
  const seenSubmittedLineIds = new Set<string>();
  const replayResults = [];

  for (const submittedLine of args.submittedLines) {
    if (seenSubmittedLineIds.has(submittedLine.line_id)) return null;
    seenSubmittedLineIds.add(submittedLine.line_id);

    const prescribedLine = prescribedLineById.get(submittedLine.line_id);
    if (!prescribedLine) return null;

    const existingResult = existingResultByLineId.get(submittedLine.line_id);
    if (!existingResult) return null;

    if (
      !dispenseResultMatchesSubmittedLine({
        existingResult,
        submittedLine,
        prescribedUnit: prescribedLine.unit,
      })
    ) {
      return null;
    }

    if (submittedLine.barcode_scan) {
      const verification = await verifyDispenseBarcodeForLine({
        client: args.tx,
        line: prescribedLine,
        barcode: submittedLine.barcode_scan.barcode,
      });
      if (!verification.evidence.match || verification.evidence.expired) return null;
    }

    replayResults.push(existingResult);
  }

  const persistedLineIds = new Set(args.existingResults.map((result) => result.line_id));
  const hasAllResults =
    args.prescribedLines.length > 0 &&
    args.prescribedLines.every((line) => persistedLineIds.has(line.id));

  return {
    results: replayResults,
    task_id: args.taskId,
    partial: !hasAllResults,
    idempotent: true as const,
  };
}

async function buildBarcodeVerificationEvidence(args: {
  tx: Prisma.TransactionClient;
  lines: Array<SubmittedDispenseResultLine>;
  prescribedLineById: Map<string, ReplayablePrescriptionLine>;
}) {
  const evidence: DispenseBarcodeVerificationEvidence[] = [];

  for (const line of args.lines) {
    if (!line.barcode_scan) continue;

    const prescribedLine = args.prescribedLineById.get(line.line_id);
    if (!prescribedLine) continue;

    const verification = await verifyDispenseBarcodeForLine({
      client: args.tx,
      line: prescribedLine,
      barcode: line.barcode_scan.barcode,
    });
    evidence.push(verification.evidence);
  }

  return evidence;
}

async function promoteCycleToDispensingIfNeeded(args: {
  tx: Parameters<typeof transitionCycleStatus>[0];
  cycleId: string;
  orgId: string;
  userId: string;
  currentStatus: string;
}) {
  if (args.currentStatus === 'dispensing' || args.currentStatus === 'inquiry_pending') {
    return;
  }

  if (args.currentStatus === 'inquiry_resolved') {
    await transitionCycleStatus(
      args.tx,
      args.cycleId,
      args.orgId,
      'ready_to_dispense',
      args.userId,
    );
    await transitionCycleStatus(args.tx, args.cycleId, args.orgId, 'dispensing', args.userId);
    return;
  }

  if (args.currentStatus === 'ready_to_dispense') {
    await transitionCycleStatus(args.tx, args.cycleId, args.orgId, 'dispensing', args.userId);
  }
}

async function authenticatedPOST(req: NextRequest) {
  const auth = await requireAuthContext(req, {
    permission: 'canDispense',
    message: '調剤結果の登録権限がありません',
  });
  if ('response' in auth) return auth.response;

  const { ctx } = auth;

  return runWithRequestAuthContext(ctx, async () => {
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = createDispenseResultSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const { task_id, lines, safety_checklist, expected_version } = parsed.data;

    const result = await withOrgContext(
      ctx.orgId,
      async (tx) => {
        const cycleAssignmentWhere = buildMedicationCycleAssignmentWhere(ctx);
        // Verify task belongs to this org
        const task = await tx.dispenseTask.findFirst({
          where: {
            id: task_id,
            org_id: ctx.orgId,
            ...(cycleAssignmentWhere ? { cycle: cycleAssignmentWhere } : {}),
          },
          include: {
            results: {
              select: {
                id: true,
                line_id: true,
                actual_drug_name: true,
                actual_drug_code: true,
                actual_quantity: true,
                actual_unit: true,
                discrepancy_reason: true,
                carry_type: true,
                special_notes: true,
              },
            },
            cycle: {
              select: {
                id: true,
                patient_id: true,
                overall_status: true,
                version: true,
                inquiries: {
                  where: {
                    OR: [{ result: null }, { result: 'pending' }],
                  },
                  select: {
                    id: true,
                    line_id: true,
                    reason: true,
                    inquiry_to_physician: true,
                  },
                },
                prescription_intakes: {
                  orderBy: { created_at: 'desc' },
                  take: 1,
                  select: {
                    id: true,
                    source_type: true,
                    original_collected_at: true,
                    lines: {
                      select: {
                        id: true,
                        drug_name: true,
                        drug_code: true,
                        quantity: true,
                        unit: true,
                      },
                    },
                  },
                },
                visit_schedules: {
                  where: {
                    schedule_status: { in: ['planned', 'in_preparation', 'ready'] },
                  },
                  select: { id: true, schedule_status: true },
                },
                case_: {
                  select: {
                    patient: {
                      select: {
                        name: true,
                      },
                    },
                  },
                },
              },
            },
          },
        });

        if (!task) return null;

        const latestIntake = task.cycle.prescription_intakes?.[0] ?? null;
        const existingResults = task.results ?? [];
        const existingResultByLineId = new Map(existingResults.map((item) => [item.line_id, item]));

        // 楽観的ロック(§12-4): クライアントがワークベンチ表示時の cycle.version を
        // 送ってきた場合のみ、書込前に現在値と照合する。ズレていれば他者更新として 409。
        // ただし同じ payload がすでに永続化済みなら、F12/二重送信による副作用を増やさず再応答する。
        if (typeof task.cycle.version === 'number' && task.cycle.version !== expected_version) {
          const idempotentReplay = await buildIdempotentDispenseResultReplay({
            tx,
            taskId: task_id,
            submittedLines: lines,
            prescribedLines: latestIntake?.lines ?? [],
            existingResults,
          });
          if (idempotentReplay) return idempotentReplay;

          return {
            error: 'version_conflict' as const,
            message: new VersionConflictError().message,
            details: {
              cycle_id: task.cycle_id,
              expected_version,
              current_version: task.cycle.version,
            },
          };
        }
        const blockedInquiryByLineId = new Map(
          task.cycle.inquiries
            .filter((item) => item.line_id)
            .map((item) => [
              item.line_id as string,
              `${item.reason}${item.inquiry_to_physician ? ` / ${item.inquiry_to_physician}` : ''}`,
            ]),
        );
        const cycleLevelInquiries = task.cycle.inquiries.filter((item) => item.line_id == null);

        if (cycleLevelInquiries.length > 0) {
          return {
            error: 'cycle_blocked' as const,
            reasons: cycleLevelInquiries.map(
              (item) =>
                `${item.reason}${item.inquiry_to_physician ? ` / ${item.inquiry_to_physician}` : ''}`,
            ),
          };
        }

        const blockedLines = lines
          .map((line) => ({
            line_id: line.line_id,
            reason: blockedInquiryByLineId.get(line.line_id) ?? null,
          }))
          .filter((line): line is { line_id: string; reason: string } => line.reason != null);

        if (blockedLines.length > 0) {
          return {
            error: 'line_blocked' as const,
            reasons: blockedLines,
          };
        }

        const discrepancyReasonErrors = buildDiscrepancyReasonErrors({
          submittedLines: lines,
          prescribedLines: latestIntake?.lines ?? [],
        });
        if (discrepancyReasonErrors.length > 0) {
          return {
            error: 'reason_required' as const,
            reasons: discrepancyReasonErrors,
          };
        }

        // B5: Line ownership validation — each submitted line_id must belong to the current intake
        const validLineIds = new Set(latestIntake?.lines.map((l) => l.id) ?? []);
        const invalidLines = lines.filter((l) => !validLineIds.has(l.line_id));
        if (invalidLines.length > 0) {
          return {
            error: 'invalid_lines' as const,
            reasons: invalidLines.map((l) => l.line_id),
          };
        }

        const unresolvedQuantityLines = buildUnresolvedPrescribedQuantityErrors({
          submittedLines: lines,
          prescribedLines: latestIntake?.lines ?? [],
        });
        if (unresolvedQuantityLines.length > 0) {
          return {
            error: 'prescribed_quantity_required' as const,
            reasons: unresolvedQuantityLines,
          };
        }

        const invalidQuantityUnitLines = buildActualQuantityUnitErrors({
          submittedLines: lines,
          prescribedLines: latestIntake?.lines ?? [],
        });
        if (invalidQuantityUnitLines.length > 0) {
          return {
            error: 'actual_quantity_unit_step_invalid' as const,
            reasons: invalidQuantityUnitLines,
          };
        }

        const invalidPackagingGroups = await findInvalidPackagingGroupAssignments({
          tx,
          orgId: ctx.orgId,
          cycleId: task.cycle_id,
          lines,
        });
        if (invalidPackagingGroups.length > 0) {
          return {
            error: 'invalid_packaging_groups' as const,
            reasons: invalidPackagingGroups,
          };
        }

        const now = new Date();
        const latestIntakeLineById = new Map(
          (latestIntake?.lines ?? []).map((line) => [line.id, line]),
        );
        const latestIntakeLineIds = latestIntake?.lines.map((line) => line.id) ?? [];
        const completedLineIds = new Set([
          ...existingResults.map((item) => item.line_id),
          ...lines.map((item) => item.line_id),
        ]);
        const blockedLineIds = new Set(
          task.cycle.inquiries
            .map((item) => item.line_id)
            .filter((lineId): lineId is string => lineId != null),
        );
        const hasRemainingBlockedLine = latestIntakeLineIds.some((lineId) =>
          blockedLineIds.has(lineId),
        );
        const hasAllResults = latestIntakeLineIds.every((lineId) => completedLineIds.has(lineId));
        const canComplete =
          cycleLevelInquiries.length === 0 &&
          !hasRemainingBlockedLine &&
          latestIntakeLineIds.length > 0 &&
          hasAllResults;

        if (!safety_checklist) {
          return { error: 'safety_checklist_required' as const };
        }

        const actualQuantityConfirmationErrors = buildActualQuantityConfirmationErrors({
          submittedLines: lines,
          prescribedLines: latestIntake?.lines ?? [],
          existingResults,
        });
        if (actualQuantityConfirmationErrors.length > 0) {
          return {
            error: 'actual_quantity_confirmation_required' as const,
            reasons: actualQuantityConfirmationErrors,
          };
        }

        const barcodeVerificationEvidence = await buildBarcodeVerificationEvidence({
          tx,
          lines,
          prescribedLineById: latestIntakeLineById,
        });
        const failedBarcodeVerifications = barcodeVerificationEvidence.filter(
          (item) => !item.match || item.expired,
        );
        if (failedBarcodeVerifications.length > 0) {
          return {
            error: 'barcode_verification_failed' as const,
            reasons: failedBarcodeVerifications,
          };
        }

        let cdsAlertCounts: ReturnType<typeof countCdsAlertsBySeverity>;
        try {
          const cdsAlerts = await checkDispenseAlerts(
            ctx.orgId,
            task.cycle_id,
            task.cycle.patient_id,
          );
          cdsAlertCounts = countCdsAlertsBySeverity(cdsAlerts);
        } catch {
          return { error: 'cds_check_unavailable' as const };
        }

        try {
          if (canComplete) {
            await promoteCycleToDispensingIfNeeded({
              tx,
              cycleId: task.cycle_id,
              orgId: ctx.orgId,
              userId: ctx.userId,
              currentStatus: task.cycle.overall_status,
            });
            await transitionCycleStatus(tx, task.cycle_id, ctx.orgId, 'audit_pending', ctx.userId);
          } else if (task.cycle.overall_status !== 'inquiry_pending') {
            await promoteCycleToDispensingIfNeeded({
              tx,
              cycleId: task.cycle_id,
              orgId: ctx.orgId,
              userId: ctx.userId,
              currentStatus: task.cycle.overall_status,
            });
          }
        } catch (err) {
          if (err instanceof InvalidTransitionError) {
            return {
              error: 'transition_error' as const,
              message: `ステータス遷移が不正です: ${err.fromStatus} → ${err.toStatus}`,
            };
          }
          if (err instanceof VersionConflictError) {
            return { error: 'version_conflict' as const, message: err.message };
          }
          throw err;
        }

        const results = await Promise.all(
          lines.map(async (line) => {
            const decision = resolveDispensingDecision(line);
            if (decision) {
              await tx.dispensingDecision.upsert({
                where: {
                  task_id_line_id: {
                    task_id,
                    line_id: line.line_id,
                  },
                },
                create: {
                  org_id: ctx.orgId,
                  task_id,
                  line_id: line.line_id,
                  dispensing_method: decision.dispensing_method,
                  packaging_method: decision.packaging_method,
                  packaging_instructions: decision.packaging_instructions,
                  packaging_group_id: decision.packaging_group_id,
                  decided_by: ctx.userId,
                  decided_at: now,
                },
                update: {
                  dispensing_method: decision.dispensing_method,
                  packaging_method: decision.packaging_method,
                  packaging_instructions: decision.packaging_instructions,
                  packaging_group_id: decision.packaging_group_id,
                  decided_by: ctx.userId,
                  decided_at: now,
                },
              });
            }

            const prescribedLine = latestIntakeLineById.get(line.line_id);
            const canonicalActualUnit = resolveCanonicalActualUnit({
              prescribedUnit: prescribedLine?.unit,
              actualUnit: line.actual_unit,
            });
            const resultData = {
              actual_drug_name: line.actual_drug_name,
              actual_drug_code: line.actual_drug_code,
              actual_quantity: line.actual_quantity,
              actual_unit: canonicalActualUnit,
              discrepancy_reason: line.discrepancy_reason,
              carry_type: line.carry_type,
              special_notes: line.special_notes,
              dispensed_by: ctx.userId,
              dispensed_at: now,
            };

            if (existingResultByLineId.has(line.line_id)) {
              return tx.dispenseResult.update({
                where: { id: existingResultByLineId.get(line.line_id)!.id },
                data: resultData,
              });
            }

            try {
              return await tx.dispenseResult.create({
                data: {
                  org_id: ctx.orgId,
                  task_id,
                  line_id: line.line_id,
                  ...resultData,
                },
              });
            } catch (err) {
              if (!isUniqueConstraintError(err)) throw err;
              const concurrentResult = await tx.dispenseResult.findFirst({
                where: {
                  org_id: ctx.orgId,
                  task_id,
                  line_id: line.line_id,
                },
                select: { id: true },
              });
              if (!concurrentResult) throw err;
              return tx.dispenseResult.update({
                where: { id: concurrentResult.id },
                data: resultData,
              });
            }
          }),
        );

        await tx.dispenseTask.update({
          where: { id: task_id },
          data: { status: canComplete ? 'completed' : 'in_progress' },
        });

        await createAuditLogEntry(tx, ctx, {
          action: 'dispense_safety_checklist_acknowledged',
          targetType: 'dispense_task',
          targetId: task_id,
          changes: {
            task_id,
            cycle_id: task.cycle_id,
            checklist: safety_checklist,
            quantity_confirmations: lines.map((line) => ({
              line_id: line.line_id,
              confirmed: line.actual_quantity_confirmed === true,
              source: line.actual_quantity_source ?? 'legacy_unmarked',
            })),
            barcode_verifications: barcodeVerificationEvidence,
            cds_alert_counts: cdsAlertCounts,
            line_count: results.length,
            partial: !canComplete,
            acknowledged_at: now.toISOString(),
          },
        });

        if (!canComplete) {
          // B3: Create WorkflowException for partial dispense (guard against duplicates)
          const missingLineIds = latestIntakeLineIds.filter(
            (lineId) => !completedLineIds.has(lineId),
          );
          const intakeLines = latestIntake?.lines ?? [];
          const missingLineNames = missingLineIds.map(
            (lineId) => intakeLines.find((l) => l.id === lineId)?.drug_name ?? lineId,
          );
          const existingPartialException = await tx.workflowException.findFirst({
            where: {
              cycle_id: task.cycle_id,
              exception_type: 'partial_dispense',
              status: 'open' satisfies ExceptionStatus,
            },
          });
          if (!existingPartialException) {
            await tx.workflowException.create({
              data: {
                org_id: ctx.orgId,
                cycle_id: task.cycle_id,
                patient_id: task.cycle.patient_id,
                exception_type: 'partial_dispense',
                severity: 'warning' satisfies ExceptionSeverity,
                status: 'open' satisfies ExceptionStatus,
                description: `部分調剤: 未調剤の行があります (${missingLineNames.join(', ')})`,
              },
            });
          }

          if (latestIntake?.source_type === 'fax' && latestIntake.original_collected_at == null) {
            const dueDate = new Date(now);
            dueDate.setDate(dueDate.getDate() + 3);
            await upsertOperationalTask(tx, {
              orgId: ctx.orgId,
              taskType: 'fax_original_followup',
              title: 'FAX処方せん原本の回収確認が必要です',
              description: '訪問時回収または後日郵送到着後に原本回収を記録してください',
              priority: 'high',
              dueDate,
              slaDueAt: dueDate,
              dedupeKey: `fax-original-followup:${latestIntake.id}`,
              relatedEntityType: 'prescription_intake',
              relatedEntityId: latestIntake.id,
              metadata: {
                cycle_id: task.cycle_id,
                task_id,
              },
            });
          }

          return { results, task_id, partial: true };
        }

        // B3: Auto-resolve open partial_dispense exceptions when all lines are complete
        await tx.workflowException.updateMany({
          where: {
            cycle_id: task.cycle_id,
            exception_type: 'partial_dispense',
            status: 'open' satisfies ExceptionStatus,
          },
          data: { status: 'resolved' satisfies ExceptionStatus, resolved_at: new Date() },
        });

        const auditRecipients = await tx.membership.findMany({
          where: {
            org_id: ctx.orgId,
            is_active: true,
            OR: [{ can_audit_dispense: true }, { role: { in: [...ADMIN_MEMBER_ROLES] } }],
            user: {
              is_active: true,
            },
          },
          select: {
            user_id: true,
          },
        });

        const explicitUserIds = Array.from(
          new Set(auditRecipients.map((member) => member.user_id)),
        );
        if (explicitUserIds.length > 0) {
          await dispatchNotificationEvent(tx, {
            orgId: ctx.orgId,
            eventType: 'dispense_audit_pending',
            type: 'business',
            title: '調剤鑑査待ちの処方があります',
            message: `${task.cycle.case_.patient.name} の調剤結果が鑑査待ちになりました`,
            link: buildAuditTaskHref(task_id),
            metadata: {
              task_id,
              cycle_id: task.cycle_id,
              priority: task.priority,
            },
            explicitUserIds,
            dedupeKey: `dispense-audit-pending:${task_id}`,
          });
        }

        const visitSchedules = task.cycle.visit_schedules;
        if (visitSchedules.length > 0) {
          const persistedResults = await tx.dispenseResult.findMany({
            where: {
              org_id: ctx.orgId,
              task_id,
            },
            select: {
              line_id: true,
              actual_drug_name: true,
              actual_drug_code: true,
              actual_quantity: true,
              actual_unit: true,
              carry_type: true,
              special_notes: true,
              line: {
                select: {
                  drug_name: true,
                  drug_code: true,
                },
              },
            },
          });

          const carryItemsStatus = resolveCarryItemsStatus(persistedResults);
          const carryItems = persistedResults.map((line) => ({
            line_id: line.line_id,
            drug_name: line.actual_drug_name || line.line?.drug_name || '',
            drug_code: normalizeOptionalText(line.actual_drug_code) ?? line.line?.drug_code ?? null,
            quantity: line.actual_quantity,
            unit: line.actual_unit,
            carry_type: line.carry_type,
            special_notes: line.special_notes,
          }));
          const readyScheduleIdsToReopen = visitSchedules
            .filter((visitSchedule) => visitSchedule.schedule_status === 'ready')
            .map((visitSchedule) => visitSchedule.id);

          if (readyScheduleIdsToReopen.length > 0) {
            await tx.visitPreparation.updateMany({
              where: {
                org_id: ctx.orgId,
                schedule_id: { in: readyScheduleIdsToReopen },
              },
              data: {
                carry_items_confirmed: false,
                prepared_at: null,
              },
            });
          }

          for (const visitSchedule of visitSchedules) {
            const shouldReopenReadySchedule = visitSchedule.schedule_status === 'ready';

            await tx.visitSchedule.update({
              where: { id: visitSchedule.id },
              data: {
                carry_items: carryItems,
                carry_items_status: carryItemsStatus,
                ...(shouldReopenReadySchedule
                  ? {
                      schedule_status: 'in_preparation',
                      pre_visit_checklist_completed: false,
                    }
                  : {}),
              },
            });
          }
        }

        if (latestIntake?.source_type === 'fax' && latestIntake.original_collected_at == null) {
          const dueDate = new Date(now);
          dueDate.setDate(dueDate.getDate() + 3);
          await upsertOperationalTask(tx, {
            orgId: ctx.orgId,
            taskType: 'fax_original_followup',
            title: 'FAX処方せん原本の回収確認が必要です',
            description: '訪問時回収または後日郵送到着後に原本回収を記録してください',
            priority: 'high',
            dueDate,
            slaDueAt: dueDate,
            dedupeKey: `fax-original-followup:${latestIntake.id}`,
            relatedEntityType: 'prescription_intake',
            relatedEntityId: latestIntake.id,
            metadata: {
              cycle_id: task.cycle_id,
              task_id,
            },
          });
        }

        return { results, task_id, partial: false };
      },
      { requestContext: ctx },
    );

    if (!result) return notFound('指定された調剤タスクが見つかりません');
    if ('error' in result) {
      if (result.error === 'cycle_blocked') {
        return validationError('疑義照会中のため調剤開始できません', {
          blocked_inquiries: result.reasons,
        });
      }
      if (result.error === 'line_blocked') {
        return validationError('疑義照会中の明細が含まれているため調剤完了できません', {
          blocked_lines: result.reasons,
        });
      }
      if (result.error === 'reason_required') {
        return validationError('差異/欠品/代替がある明細は理由コードを入力してください', {
          discrepancy_lines: result.reasons,
        });
      }
      if (result.error === 'invalid_lines') {
        return validationError('指定された処方明細は現在の処方に属していません', {
          invalid_line_ids: result.reasons,
        });
      }
      if (result.error === 'prescribed_quantity_required') {
        return validationError(
          '処方数量が未確定の明細があります。処方取込で数量を確認してから調剤完了してください',
          {
            unresolved_quantity_lines: result.reasons,
          },
        );
      }
      if (result.error === 'actual_quantity_confirmation_required') {
        return validationError(
          '調剤実数量の確認元が未確定の明細があります。数量確認後に調剤完了してください',
          {
            actual_quantity_confirmation_lines: result.reasons,
          },
        );
      }
      if (result.error === 'barcode_verification_failed') {
        return validationError('バーコード照合に失敗した明細があります', {
          barcode_verification_lines: result.reasons,
        });
      }
      if (result.error === 'actual_quantity_unit_step_invalid') {
        return validationError('実数量が単位に合う刻みではありません', {
          actual_quantity_unit_lines: result.reasons,
        });
      }
      if (result.error === 'invalid_packaging_groups') {
        return validationError('指定された包装グループは現在の調剤サイクルに属していません', {
          invalid_packaging_groups: result.reasons,
        });
      }
      if (result.error === 'safety_checklist_required') {
        return validationError(
          '調剤結果の保存には患者・薬剤・数量・用法・保管・安全アラートの確認が必要です',
          {
            safety_checklist: ['required'],
          },
        );
      }
      if (result.error === 'cds_check_unavailable') {
        return validationError(
          '処方安全チェックを完了できません。禁忌・相互作用・アレルギー等を確認できる状態で再試行してください',
          {
            cds_check: ['unavailable'],
          },
        );
      }
      if (result.error === 'transition_error') {
        return validationError(result.message);
      }
      if (result.error === 'version_conflict') {
        return conflict(result.message, 'details' in result ? result.details : undefined);
      }
    }

    if (!('idempotent' in result)) {
      await notifyWorkflowMutation({
        orgId: ctx.orgId,
        eventType: 'cycle_transition',
        payload: { source: 'dispense_results', task_id },
      });

      if (!result.partial) {
        await notifyWebhookEventForOrg(ctx.orgId, 'prescription.dispensed', {
          taskId: result.task_id,
          resultCount: result.results.length,
        });
      }
    }

    return success(result, 'idempotent' in result ? 200 : 201);
  });
}

export async function POST(req: NextRequest) {
  return withRoutePerformance(req, async () => {
    try {
      return withSensitiveNoStore(await authenticatedPOST(req));
    } catch (err) {
      unstable_rethrow(err);
      logger.error('dispense_results_post_unhandled_error', undefined, {
        event: 'dispense_results_post_unhandled_error',
        route: ROUTE,
        method: 'POST',
        status: 500,
        error_name: safeErrorName(err),
      });
      return withSensitiveNoStore(internalError());
    }
  });
}
