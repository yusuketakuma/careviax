import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { withOrgContext } from '@/lib/db/rls';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { success, validationError, notFound } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import { validateOrgReferences } from '@/lib/api/org-reference';
import {
  buildVisitScheduleProposalAssignmentWhere,
  buildVisitScheduleProposalCaseAccessWhere,
} from '@/lib/auth/visit-schedule-access';
import {
  generateVisitScheduleProposalSchema,
  proposalStatusSchema,
} from '@/lib/validations/visit-schedule-proposal';
import { visitScheduleDateKeySchema } from '@/lib/validations/visit-schedule';
import { resolveBillingRulesForDate } from '@/server/services/billing-rules';
import { resolveBillingPayerBasis } from '@/server/services/billing-payer-basis';
import { resolvePatientInsurance } from '@/server/services/patient-insurance';
import { findLatestPrescriptionIntakeClassification } from '@/server/services/prescription-intake-classification';
import { generateVisitScheduleProposalDrafts } from '@/server/services/visit-schedule-planner';
import {
  formatVisitWorkflowGateIssues,
  type VisitWorkflowGateIssue,
} from '@/server/services/management-plans';
import { notifyWorkflowMutation } from '@/server/services/workflow-dashboard-cache';
import {
  validateBillingRequirements,
  type BillingRequirementAlert,
} from '@/server/services/billing-requirement-validator';
import type { ProposalCandidateDiagnostic } from '@/server/services/visit-schedule-planner';

const proposalDateQuerySchema = visitScheduleDateKeySchema('日付形式が不正です（YYYY-MM-DD）');

function startOfMonth(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1));
}

function parseProposalDateQuery(value: string | null, fieldName: 'date_from' | 'date_to') {
  if (value == null) {
    return { ok: true as const, value: null };
  }

  const parsed = proposalDateQuerySchema.safeParse(value);
  if (!parsed.success) {
    return {
      ok: false as const,
      response: validationError(`${fieldName} の日付形式が不正です（YYYY-MM-DD）`),
    };
  }

  return { ok: true as const, value: parsed.data };
}

/**
 * 訪問提案作成時の算定制限チェック。
 *
 * 新バリデーター（validateBillingRequirements）に委譲し、
 * severity: 'error' のアラートをブロッキングメッセージに変換する。
 * sameMonthExclusiveCodes チェック（BillingCandidate ベース）は
 * 新バリデーターの対象外のため、ここで保持する。
 *
 * 戻り値:
 * - blockingMessages: string[] — 空でなければ提案作成をブロック
 * - alerts: BillingRequirementAlert[] — 全アラート（UI表示用）
 */
async function validateProposalBillingExclusions(args: {
  orgId: string;
  caseId: string;
  visitType: string;
  targetDate: Date;
  pharmacistId?: string;
  prescriptionCategory?: 'regular' | 'emergency';
  specialCapEligible?: boolean;
}): Promise<{ blockingMessages: string[]; alerts: BillingRequirementAlert[] }> {
  const careCase = await prisma.careCase.findFirst({
    where: {
      id: args.caseId,
      org_id: args.orgId,
    },
    select: {
      patient_id: true,
      patient: {
        select: {
          medical_insurance_number: true,
          care_insurance_number: true,
        },
      },
    },
  });

  if (!careCase) {
    return { blockingMessages: ['ケースが見つかりません'], alerts: [] };
  }

  const [medicalInsurance, careInsurance] = await Promise.all([
    resolvePatientInsurance(prisma, {
      orgId: args.orgId,
      patientId: careCase.patient_id,
      type: 'medical',
      asOf: args.targetDate,
    }),
    resolvePatientInsurance(prisma, {
      orgId: args.orgId,
      patientId: careCase.patient_id,
      type: 'care',
      asOf: args.targetDate,
    }),
  ]);

  const payerBasis = resolveBillingPayerBasis({
    medicalInsuranceNumber: medicalInsurance?.number ?? careCase.patient.medical_insurance_number,
    careInsuranceNumber: careInsurance?.number ?? careCase.patient.care_insurance_number,
    visitType: args.visitType,
  });

  const blockingMessages: string[] = [];

  // ── sameMonthExclusiveCodes チェック（BillingCandidate ベース、保持） ──
  if (payerBasis !== 'self_pay') {
    const targetRules = resolveBillingRulesForDate({
      payerBasis,
      asOfDate: args.targetDate,
    }).filter((rule) => rule.rule_type === 'base' && rule.provider_scope === 'pharmacy');
    const sameMonthExclusiveCodes = new Set(
      targetRules.flatMap((rule) => rule.exclusion_rules?.same_month_exclusive ?? []),
    );
    const targetMonth = startOfMonth(args.targetDate);

    const existingCandidates = await prisma.billingCandidate.findMany({
      where: {
        org_id: args.orgId,
        patient_id: careCase.patient_id,
        billing_month: targetMonth,
        status: { in: ['candidate', 'confirmed', 'exported'] },
      },
      select: { billing_code: true, billing_name: true },
    });

    const sameMonthExclusiveMatches = existingCandidates.filter((candidate) =>
      sameMonthExclusiveCodes.has(candidate.billing_code),
    );
    if (sameMonthExclusiveMatches.length > 0) {
      blockingMessages.push(
        `同月併算定不可の請求候補が存在します: ${sameMonthExclusiveMatches
          .map((candidate) => candidate.billing_name)
          .join(' / ')}`,
      );
    }
  }

  // ── 新バリデーターに委譲（月上限チェック含む） ──
  let alerts: BillingRequirementAlert[] = [];
  if (payerBasis !== 'self_pay' && args.pharmacistId) {
    alerts = await validateBillingRequirements({
      orgId: args.orgId,
      caseId: args.caseId,
      patientId: careCase.patient_id,
      pharmacistId: args.pharmacistId,
      visitType: args.visitType,
      proposedDate: args.targetDate,
      prescriptionCategory: args.prescriptionCategory,
      payerBasis,
      specialCapEligible: args.specialCapEligible,
    });

    // severity: 'error' のアラートをブロッキングメッセージに変換
    for (const alert of alerts) {
      if (alert.severity === 'error') {
        blockingMessages.push(alert.message);
      }
    }
  }

  return { blockingMessages, alerts };
}

function dedupeBillingAlerts(alerts: BillingRequirementAlert[]) {
  const seen = new Set<string>();

  return alerts.filter((alert) => {
    const key = `${alert.type}:${alert.severity}:${alert.message}:${JSON.stringify(alert.details)}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export const GET = withAuth(
  async (req: AuthenticatedRequest) => {
    const { searchParams } = new URL(req.url);
    const caseId = searchParams.get('case_id');
    const patientId = searchParams.get('patient_id');
    const status = searchParams.get('status');
    const dateFrom = searchParams.get('date_from');
    const dateTo = searchParams.get('date_to');
    const assignmentWhere = buildVisitScheduleProposalAssignmentWhere(req);

    const parsedStatus = status ? proposalStatusSchema.safeParse(status) : null;
    if (parsedStatus && !parsedStatus.success) {
      return validationError('status が不正です');
    }

    const parsedDateFrom = parseProposalDateQuery(dateFrom, 'date_from');
    if (!parsedDateFrom.ok) return parsedDateFrom.response;
    const parsedDateTo = parseProposalDateQuery(dateTo, 'date_to');
    if (!parsedDateTo.ok) return parsedDateTo.response;

    const proposals = await prisma.visitScheduleProposal.findMany({
      where: {
        org_id: req.orgId,
        ...(caseId ? { case_id: caseId } : {}),
        ...(patientId
          ? {
              case_: {
                is: {
                  patient_id: patientId,
                },
              },
            }
          : {}),
        ...(parsedStatus ? { proposal_status: parsedStatus.data } : {}),
        ...(dateFrom || dateTo
          ? {
              proposed_date: {
                ...(parsedDateFrom.value ? { gte: new Date(parsedDateFrom.value) } : {}),
                ...(parsedDateTo.value ? { lte: new Date(parsedDateTo.value) } : {}),
              },
            }
          : {}),
        ...(assignmentWhere ? { AND: [assignmentWhere] } : {}),
      },
      include: {
        case_: {
          include: {
            patient: {
              include: {
                residences: {
                  where: { is_primary: true },
                  take: 1,
                },
              },
            },
          },
        },
        site: {
          select: {
            id: true,
            name: true,
            address: true,
            lat: true,
            lng: true,
          },
        },
        vehicle_resource: {
          select: {
            id: true,
            label: true,
            travel_mode: true,
            max_stops: true,
            max_route_duration_minutes: true,
          },
        },
        finalized_schedule: {
          select: {
            id: true,
            scheduled_date: true,
            pharmacist_id: true,
          },
        },
        reschedule_source_schedule: {
          select: {
            id: true,
            scheduled_date: true,
            pharmacist_id: true,
            override_request: {
              select: {
                status: true,
                impact_summary: true,
              },
            },
          },
        },
        contact_logs: {
          orderBy: { called_at: 'desc' },
          take: 10,
        },
      },
      orderBy: [{ proposed_date: 'asc' }, { time_window_start: 'asc' }],
    });

    const pharmacistIds = Array.from(
      new Set(proposals.map((proposal) => proposal.proposed_pharmacist_id)),
    );
    const pharmacists =
      pharmacistIds.length === 0
        ? []
        : await prisma.user.findMany({
            where: {
              org_id: req.orgId,
              id: { in: pharmacistIds },
            },
            select: {
              id: true,
              name: true,
              name_kana: true,
            },
          });
    const pharmacistById = new Map(pharmacists.map((pharmacist) => [pharmacist.id, pharmacist]));

    return success({
      data: proposals.map((proposal) => ({
        ...proposal,
        proposed_pharmacist: pharmacistById.get(proposal.proposed_pharmacist_id) ?? null,
      })),
    });
  },
  {
    permission: 'canVisit',
    message: '訪問候補の閲覧権限がありません',
  },
);

export const POST = withAuth(
  async (req: AuthenticatedRequest) => {
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = generateVisitScheduleProposalSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const caseAccessWhere = buildVisitScheduleProposalCaseAccessWhere(
      req,
      parsed.data.preferred_pharmacist_id,
    );
    const accessibleCase = await prisma.careCase.findFirst({
      where: {
        id: parsed.data.case_id,
        org_id: req.orgId,
        ...(caseAccessWhere ? { AND: [caseAccessWhere] } : {}),
      },
      select: { id: true },
    });
    if (!accessibleCase) return notFound('ケースが見つかりません');

    const refResult = await validateOrgReferences(req.orgId, {
      case_id: parsed.data.case_id,
      ...(parsed.data.preferred_pharmacist_id
        ? { pharmacist_id: parsed.data.preferred_pharmacist_id }
        : {}),
      ...(parsed.data.reschedule_source_schedule_id
        ? { schedule_id: parsed.data.reschedule_source_schedule_id }
        : {}),
    });
    if (!refResult.ok) return refResult.response;

    const hasExplicitVisitType = Object.prototype.hasOwnProperty.call(payload, 'visit_type');
    // Auto-propagate visitType from active PrescriptionIntake when not provided
    let resolvedVisitType = parsed.data.visit_type;
    if (hasExplicitVisitType) {
      resolvedVisitType = parsed.data.visit_type;
    } else {
      const activeIntake = await findLatestPrescriptionIntakeClassification(prisma, {
        orgId: req.orgId,
        caseId: parsed.data.case_id,
      });
      resolvedVisitType =
        activeIntake?.prescription_category === 'emergency' ? 'emergency' : 'regular';
    }
    const hasExplicitPriority = Object.prototype.hasOwnProperty.call(payload, 'priority');
    const resolvedPriority =
      !hasExplicitPriority && resolvedVisitType === 'emergency'
        ? 'emergency'
        : parsed.data.priority;

    const { blockingMessages, alerts: billingAlerts } = await validateProposalBillingExclusions({
      orgId: req.orgId,
      caseId: parsed.data.case_id,
      visitType: resolvedVisitType,
      targetDate: parsed.data.start_date ? new Date(parsed.data.start_date) : new Date(),
      prescriptionCategory: resolvedVisitType === 'emergency' ? 'emergency' : 'regular',
      specialCapEligible: parsed.data.special_cap_eligible,
    });
    if (blockingMessages.length > 0) {
      return validationError(blockingMessages.join(' / '));
    }

    const vehicleResource = parsed.data.vehicle_resource_id
      ? await prisma.visitVehicleResource.findFirst({
          where: {
            org_id: req.orgId,
            id: parsed.data.vehicle_resource_id,
            available: true,
          },
          select: {
            id: true,
            site_id: true,
            label: true,
            travel_mode: true,
          },
        })
      : null;
    if (parsed.data.vehicle_resource_id && !vehicleResource) {
      return validationError('選択した車両リソースが見つからないか利用できません');
    }
    const effectiveTravelMode = vehicleResource?.travel_mode ?? parsed.data.travel_mode;

    let drafts;
    let plannerDiagnostics:
      | {
          accepted: Array<{
            pharmacist_id: string;
            pharmacist_name: string;
            site_id: string | null;
            site_name: string | null;
            proposed_date: string;
            travel_mode: string;
            route_order: number;
            route_distance_score: number;
            travel_summary: string;
            vehicle_resource_id: string | null;
            vehicle_resource_label: string | null;
            vehicle_load: number | null;
            assignment_mode: string;
            care_relationship: string;
            score: number;
            score_breakdown: Record<string, number>;
            time_window_start: Date;
            time_window_end: Date;
          }>;
          rejected: ProposalCandidateDiagnostic[];
        }
      | undefined;
    try {
      const plannerResult = await generateVisitScheduleProposalDrafts({
        orgId: req.orgId,
        caseId: parsed.data.case_id,
        visitType: resolvedVisitType,
        priority: resolvedPriority,
        candidateCount: parsed.data.candidate_count,
        travelMode: effectiveTravelMode,
        startDate: parsed.data.start_date ? new Date(parsed.data.start_date) : undefined,
        lockedDate: parsed.data.locked_date ? new Date(parsed.data.locked_date) : undefined,
        preferredTimeFrom: parsed.data.preferred_time_from,
        preferredTimeTo: parsed.data.preferred_time_to,
        preferredPharmacistId: parsed.data.preferred_pharmacist_id,
        vehicleResourceId: parsed.data.vehicle_resource_id,
        rescheduleSourceScheduleId: parsed.data.reschedule_source_schedule_id,
      });
      drafts = plannerResult.drafts;
      plannerDiagnostics = plannerResult.diagnostics;
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('VISIT_WORKFLOW_GATE:')) {
        const issues = error.message
          .replace('VISIT_WORKFLOW_GATE:', '')
          .split(',')
          .filter(Boolean) as VisitWorkflowGateIssue[];
        return validationError(formatVisitWorkflowGateIssues(issues));
      }
      throw error;
    }

    if (drafts.length === 0) {
      return validationError('シフト・休日・期限条件に合う候補を生成できませんでした', {
        rejections: plannerDiagnostics?.rejected ?? [],
      });
    }

    if (vehicleResource) {
      const mismatchedDraft = drafts.find((draft) => draft.site_id !== vehicleResource.site_id);
      if (mismatchedDraft) {
        return validationError('選択した車両リソースは訪問候補の拠点では利用できません');
      }
      drafts = drafts.map((draft) => ({
        ...draft,
        vehicle_resource_id: vehicleResource.id,
      }));
    }

    const perDraftValidationKeys = new Set<string>();
    const draftValidationPairs = await Promise.all(
      drafts.map(async (draft) => {
        const validationKey = `${draft.proposed_pharmacist_id}:${draft.proposed_date.toISOString()}`;
        if (perDraftValidationKeys.has(validationKey)) {
          return { draft, validation: null };
        }
        perDraftValidationKeys.add(validationKey);

        const validation = await validateProposalBillingExclusions({
          orgId: req.orgId,
          caseId: parsed.data.case_id,
          visitType: resolvedVisitType,
          targetDate: draft.proposed_date,
          pharmacistId: draft.proposed_pharmacist_id,
          prescriptionCategory: resolvedVisitType === 'emergency' ? 'emergency' : 'regular',
        });

        return { draft, validation };
      }),
    );

    const validationByKey = new Map(
      draftValidationPairs
        .filter(
          (
            pair,
          ): pair is {
            draft: (typeof drafts)[number];
            validation: NonNullable<typeof pair.validation>;
          } => pair.validation != null,
        )
        .map((pair) => [
          `${pair.draft.proposed_pharmacist_id}:${pair.draft.proposed_date.toISOString()}`,
          pair.validation,
        ]),
    );
    const validDrafts = drafts.filter((draft) => {
      const validation = validationByKey.get(
        `${draft.proposed_pharmacist_id}:${draft.proposed_date.toISOString()}`,
      );
      return (validation?.blockingMessages.length ?? 0) === 0;
    });
    const rejectedByBilling = drafts
      .filter((draft) => !validDrafts.includes(draft))
      .map((draft) => ({
        pharmacist_id: draft.proposed_pharmacist_id,
        pharmacist_name:
          plannerDiagnostics?.accepted.find(
            (item) =>
              item.pharmacist_id === draft.proposed_pharmacist_id &&
              item.proposed_date === draft.proposed_date.toISOString().slice(0, 10),
          )?.pharmacist_name ?? draft.proposed_pharmacist_id,
        site_id: draft.site_id ?? null,
        site_name: null,
        proposed_date: draft.proposed_date.toISOString().slice(0, 10),
        travel_mode: effectiveTravelMode,
        reason_code: 'billing_constraint' as const,
        reason_label: '算定制約',
        detail:
          validationByKey
            .get(`${draft.proposed_pharmacist_id}:${draft.proposed_date.toISOString()}`)
            ?.blockingMessages.join(' / ') ?? '算定要件を満たしません',
      }));
    const allBlockingMessages = Array.from(
      new Set([
        ...blockingMessages,
        ...Array.from(validationByKey.values()).flatMap(
          (validation) => validation.blockingMessages,
        ),
      ]),
    );
    if (validDrafts.length === 0) {
      return validationError(
        allBlockingMessages.join(' / ') || '算定要件を満たす訪問候補を生成できませんでした',
        {
          rejections: [...(plannerDiagnostics?.rejected ?? []), ...rejectedByBilling],
        },
      );
    }
    const allAlerts = dedupeBillingAlerts([
      ...billingAlerts,
      ...Array.from(validationByKey.values()).flatMap((validation) => validation.alerts),
    ]);
    const acceptedDiagnostics =
      plannerDiagnostics?.accepted.filter((item) =>
        validDrafts.some(
          (draft) =>
            draft.proposed_pharmacist_id === item.pharmacist_id &&
            draft.proposed_date.toISOString().slice(0, 10) === item.proposed_date,
        ),
      ) ?? [];

    const proposals = await withOrgContext(req.orgId, async (tx) => {
      if (!parsed.data.reschedule_source_schedule_id) {
        await tx.visitScheduleProposal.updateMany({
          where: {
            org_id: req.orgId,
            case_id: parsed.data.case_id,
            proposal_status: {
              in: ['proposed', 'patient_contact_pending', 'reschedule_pending'],
            },
          },
          data: {
            proposal_status: 'superseded',
          },
        });
      }

      const created = await Promise.all(
        validDrafts.map((draft) =>
          tx.visitScheduleProposal.create({
            data: draft,
          }),
        ),
      );

      await Promise.all(
        created.map((proposal) => {
          const acceptedDiagnostic =
            acceptedDiagnostics.find(
              (item) =>
                item.pharmacist_id === proposal.proposed_pharmacist_id &&
                item.proposed_date === proposal.proposed_date.toISOString().slice(0, 10),
            ) ?? null;

          return tx.auditLog.create({
            data: {
              org_id: req.orgId,
              actor_id: req.userId,
              action: 'visit_schedule_proposals_created',
              target_type: 'VisitScheduleProposal',
              target_id: proposal.id,
              changes: {
                diagnostics: {
                  accepted: acceptedDiagnostic ? [acceptedDiagnostic] : [],
                  rejected: [...(plannerDiagnostics?.rejected ?? []), ...rejectedByBilling],
                },
              },
            },
          });
        }),
      );

      return created;
    });

    await notifyWorkflowMutation({
      orgId: req.orgId,
      payload: { source: 'visit_schedule_proposals_create', case_id: parsed.data.case_id },
    });

    return success(
      {
        data: proposals,
        alerts: allAlerts,
        diagnostics: {
          accepted: acceptedDiagnostics,
          rejected: [...(plannerDiagnostics?.rejected ?? []), ...rejectedByBilling],
        },
      },
      201,
    );
  },
  {
    permission: 'canVisit',
    message: '訪問候補の生成権限がありません',
  },
);
