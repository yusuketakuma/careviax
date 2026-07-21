import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { buildAuditTaskHref } from '@/lib/audit/navigation';
import { NextRequest } from 'next/server';
import { withAuthContext, type AuthContext } from '@/lib/auth/context';
import { ADMIN_MEMBER_ROLES } from '@/lib/auth/member-roles';
import { withOrgContext } from '@/lib/db/rls';
import { runWithRequestAuthContext } from '@/lib/auth/request-context';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { toPrismaJsonInput } from '@/lib/db/json';
import { success, validationError, notFound, conflict } from '@/lib/api/response';
import { dispatchNotificationEvent } from '@/server/services/notifications';
import { enqueuePrescriptionDispensedWebhook } from '@/server/services/outbound-webhook-queue';
import { notifyWorkflowMutation } from '@/server/services/workflow-dashboard-cache';
import { upsertOperationalTask } from '@/server/services/operational-tasks';
import { checkDispenseAlerts } from '@/server/cds/checker';
import { buildMedicationCycleAssignmentWhere } from '@/server/services/prescription-access';
import {
  transitionCycleStatus,
  InvalidTransitionError,
  VersionConflictError,
} from '@/lib/db/cycle-transition';
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
import { selectLatestDrugPriceVersionsByDrugMasterIdForAsOf } from './drug-price-version-selection';
import { Prisma } from '@prisma/client';
import type { ExceptionSeverity, ExceptionStatus } from '@/types/domain-literals';
import { createDispenseResultSchema, type SubmittedDispenseResultLine } from './route.schema';
import {
  buildIdempotentDispenseResultReplay,
  normalizeOptionalText,
  type ReplayablePrescriptionLine,
} from './route.replay';

type DrugPriceSnapshot = {
  drug_price_version_id: string | null;
  drug_price_snapshot: Prisma.Decimal | null;
  drug_price_effective_from_snapshot: Date | null;
  drug_price_source_snapshot: Prisma.InputJsonValue | typeof Prisma.DbNull | typeof Prisma.JsonNull;
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

function resolveDispensingDecision(line: SubmittedDispenseResultLine) {
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

async function buildDrugPriceSnapshotByLineId(args: {
  tx: Prisma.TransactionClient;
  lines: Array<SubmittedDispenseResultLine>;
  prescribedLineById: Map<string, ReplayablePrescriptionLine>;
  asOf: Date;
}) {
  const drugMasterIds = Array.from(
    new Set(
      args.lines
        .map((line) => args.prescribedLineById.get(line.line_id)?.drug_master_id ?? null)
        .filter((id): id is string => Boolean(id)),
    ),
  );
  if (drugMasterIds.length === 0) return new Map<string, DrugPriceSnapshot>();

  const versions = await args.tx.drugPriceVersion.findMany({
    where: {
      drug_master_id: { in: drugMasterIds },
      effective_from: { lte: args.asOf },
      OR: [{ effective_to: null }, { effective_to: { gte: args.asOf } }],
    },
    orderBy: [{ drug_master_id: 'asc' }, { effective_from: 'desc' }],
    select: {
      id: true,
      drug_master_id: true,
      source: true,
      source_url: true,
      source_file_hash: true,
      source_published_at: true,
      effective_from: true,
      effective_to: true,
      drug_price: true,
      import_log_id: true,
    },
  });

  const latestVersionByDrugMasterId = selectLatestDrugPriceVersionsByDrugMasterIdForAsOf(
    versions,
    args.asOf,
  );

  const snapshots = new Map<string, DrugPriceSnapshot>();
  for (const line of args.lines) {
    const drugMasterId = args.prescribedLineById.get(line.line_id)?.drug_master_id ?? null;
    const version = drugMasterId ? latestVersionByDrugMasterId.get(drugMasterId) : null;
    if (!version) continue;

    snapshots.set(line.line_id, {
      drug_price_version_id: version.id,
      drug_price_snapshot: version.drug_price,
      drug_price_effective_from_snapshot: version.effective_from,
      drug_price_source_snapshot: toPrismaJsonInput({
        source: version.source,
        source_url: version.source_url,
        source_file_hash: version.source_file_hash,
        source_published_at: version.source_published_at?.toISOString() ?? null,
        import_log_id: version.import_log_id,
      }),
    });
  }

  return snapshots;
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

async function authenticatedPOST(req: NextRequest, ctx: AuthContext) {
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
                        drug_master_id: true,
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

        const priceSnapshotByLineId = await buildDrugPriceSnapshotByLineId({
          tx,
          lines,
          prescribedLineById: latestIntakeLineById,
          asOf: now,
        });

        // CXR1-CONC01: for partial dispenses, serialize concurrent submissions on
        // this cycle by row-locking it FOR UPDATE before any writes. This both
        // makes the open partial_dispense exception dedup below atomic and keeps
        // the lock order (cycle → dispense rows) identical to the completing path
        // (which locks the cycle via transitionCycleStatus above), avoiding a
        // deadlock between a concurrent partial and completing submission.
        if (!canComplete) {
          await tx.$queryRaw(
            Prisma.sql`SELECT "id" FROM "MedicationCycle" WHERE "id" = ${task.cycle_id} AND "org_id" = ${ctx.orgId} FOR UPDATE`,
          );
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
              ...(priceSnapshotByLineId.get(line.line_id) ?? {
                drug_price_version_id: null,
                drug_price_snapshot: null,
                drug_price_effective_from_snapshot: null,
                drug_price_source_snapshot: Prisma.DbNull,
              }),
              dispensed_by: ctx.userId,
              dispensed_at: now,
            };

            return tx.dispenseResult.upsert({
              where: {
                org_id_task_id_line_id: {
                  org_id: ctx.orgId,
                  task_id,
                  line_id: line.line_id,
                },
              },
              create: {
                org_id: ctx.orgId,
                task_id,
                line_id: line.line_id,
                ...resultData,
              },
              update: resultData,
            });
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
          // B3: Create WorkflowException for partial dispense (guard against
          // duplicates). The cycle was row-locked FOR UPDATE above, so this
          // findFirst/create dedup runs under mutual exclusion: a concurrent
          // partial submission blocks until this transaction commits and then
          // observes the exception created here (CXR1-CONC01).
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

        await enqueuePrescriptionDispensedWebhook(tx, {
          orgId: ctx.orgId,
          taskId: task_id,
          resultCount: results.length,
        });

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
    }

    return success({ data: result }, 'idempotent' in result ? 200 : 201);
  });
}

export const POST = withAuthContext(authenticatedPOST, {
  permission: 'canDispense',
  message: '調剤結果の登録権限がありません',
});
