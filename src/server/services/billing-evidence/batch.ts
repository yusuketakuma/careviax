import type { Prisma } from '@prisma/client';
import { normalizeJsonInput } from '@/lib/db/json';
import type { Tx } from './core';
import {
  buildBillingCandidateSpecs,
  ensureHomeCareBillingSsot,
  type HomeCareBillingRuleEngineTx,
} from '../home-care-billing-ssot';
import {
  startOfMonth,
  asRecord,
  readBillingCandidateWorkflowState,
  writeBillingCandidateWorkflowState,
  mergeCandidateSourceSnapshot,
} from './core';
import {
  generateInformationProvisionCandidates,
  type InformationProvisionCandidatesTx,
} from './information-provision';
import {
  generateHomeDuplicateInteractionCandidates,
  type HomeDuplicateInteractionCandidatesTx,
} from './duplicate-interaction';
import {
  persistRegeneratedBillingCandidate,
  resolveRegeneratedCandidateStatus,
  type RegeneratedBillingCandidateRecord,
  type RegeneratedBillingCandidateTx,
} from './candidate-regeneration';

function isInputJsonObject(
  value: Prisma.InputJsonValue | null | undefined,
): value is Prisma.InputJsonObject {
  return (
    typeof value === 'object' && value !== null && !Array.isArray(value) && !('toJSON' in value)
  );
}

function normalizedJsonObject(value: unknown): Prisma.InputJsonObject {
  const normalized = normalizeJsonInput(value);
  return isInputJsonObject(normalized) ? normalized : {};
}

function toPayerBasis(value: string): 'medical' | 'care' {
  return value === 'care' ? 'care' : 'medical';
}

function readFacilityStandards(context: Record<string, unknown>): Record<string, boolean> {
  const raw =
    typeof context.facility_standards === 'object' &&
    context.facility_standards !== null &&
    !Array.isArray(context.facility_standards)
      ? context.facility_standards
      : {};
  return Object.fromEntries(
    Object.entries(raw).filter((entry): entry is [string, boolean] => entry[1] === true),
  );
}

type GenerateBillingCandidatesTx = InformationProvisionCandidatesTx &
  HomeDuplicateInteractionCandidatesTx &
  RegeneratedBillingCandidateTx &
  HomeCareBillingRuleEngineTx & {
    billingCandidate: {
      findMany(args: unknown): Promise<RegeneratedBillingCandidateRecord[]>;
      upsert(args: unknown): Promise<unknown>;
      updateMany?(args: unknown): Promise<{ count: number }>;
      findFirst?(
        args: unknown,
      ): Promise<{ status: string; source_snapshot?: Prisma.JsonValue | null } | null>;
      deleteMany(args: unknown): Promise<unknown>;
    };
    billingEvidence: {
      findMany(args: unknown): Promise<
        Array<{
          id: string;
          patient_id: string | null;
          cycle_id: string | null;
          visit_record_id?: string | null;
          payer_basis: string;
          billing_service_type: string;
          provider_scope: string;
          building_patient_count: number | null;
          monthly_count_snapshot: number | null;
          weekly_count_snapshot: number | null;
          claimable: boolean;
          exclusion_reason: string | null;
          calculation_context?: Prisma.JsonValue | null;
        }>
      >;
    };
    visitRecord?: {
      findMany(args: unknown): Promise<Array<{ id: string; visit_date: Date }>>;
    };
  };

type GeneratedBillingCandidate = { status: string };

export async function generateBillingCandidatesForMonth(
  tx: Tx,
  args: { orgId: string; billingMonth: Date },
): Promise<GeneratedBillingCandidate[]>;
export async function generateBillingCandidatesForMonth(
  tx: GenerateBillingCandidatesTx,
  args: { orgId: string; billingMonth: Date },
): Promise<GeneratedBillingCandidate[]>;
export async function generateBillingCandidatesForMonth(
  tx: Tx | GenerateBillingCandidatesTx,
  args: { orgId: string; billingMonth: Date },
): Promise<GeneratedBillingCandidate[]> {
  const db = tx as GenerateBillingCandidatesTx;
  await ensureHomeCareBillingSsot(db, args.orgId, { asOfDate: args.billingMonth });
  const monthStart = startOfMonth(args.billingMonth);
  const evidences = await db.billingEvidence.findMany({
    where: {
      org_id: args.orgId,
      billing_month: monthStart,
    },
    orderBy: [{ created_at: 'asc' }],
  });
  const visitRecordIds = evidences
    .map((evidence) => evidence.visit_record_id)
    .filter((value): value is string => typeof value === 'string' && value.length > 0);
  const visitDates =
    visitRecordIds.length > 0 && db.visitRecord
      ? await db.visitRecord.findMany({
          where: { id: { in: visitRecordIds } },
          select: { id: true, visit_date: true },
        })
      : [];
  const visitDateByRecordId = new Map(
    visitDates.map((visitRecord) => [visitRecord.id, visitRecord.visit_date]),
  );

  const created: GeneratedBillingCandidate[] = [];
  const rules = await db.billingRule.findMany({
    where: {
      org_id: args.orgId,
      billing_scope: 'home_care_ssot',
      is_active: true,
      OR: [{ effective_from: null }, { effective_from: { lte: monthStart } }],
      AND: [{ OR: [{ effective_to: null }, { effective_to: { gte: monthStart } }] }],
    },
    select: {
      id: true,
      ssot_key: true,
    },
  });
  const ruleIdByKey = new Map(
    rules.filter((rule) => rule.ssot_key).map((rule) => [rule.ssot_key as string, rule.id]),
  );
  const existingCandidates = await db.billingCandidate.findMany({
    where: {
      org_id: args.orgId,
      billing_month: monthStart,
    },
    select: {
      id: true,
      dedupe_key: true,
      status: true,
      updated_at: true,
      source_snapshot: true,
    },
  });
  const existingByKey = new Map(
    existingCandidates
      .filter((candidate) => candidate.dedupe_key)
      .map((candidate) => [candidate.dedupe_key as string, candidate]),
  );
  const blockedEvidenceIds: string[] = [];
  const claimableEvidenceByPatient = new Map<string, { any: number; care: number }>();

  for (const evidence of evidences) {
    if (!evidence.patient_id || !evidence.claimable) continue;
    const current = claimableEvidenceByPatient.get(evidence.patient_id) ?? { any: 0, care: 0 };
    current.any += 1;
    if (evidence.billing_service_type === 'care_home_management') {
      current.care += 1;
    }
    claimableEvidenceByPatient.set(evidence.patient_id, current);
  }

  for (const evidence of evidences) {
    if (!evidence.patient_id) continue;
    if (!evidence.claimable) {
      blockedEvidenceIds.push(evidence.id);
      continue;
    }
    const calculationContext = asRecord(evidence.calculation_context);
    const regionAddOnEligible = Array.isArray(calculationContext.region_add_on_eligible)
      ? calculationContext.region_add_on_eligible.filter(
          (value): value is 'special_15' | 'small_office_10' | 'resident_5' =>
            value === 'special_15' || value === 'small_office_10' || value === 'resident_5',
        )
      : [];
    const emergencyCategory =
      calculationContext.emergency_category === 'planned_disease_exacerbation' ||
      calculationContext.emergency_category === 'other_exacerbation' ||
      calculationContext.emergency_category === 'online'
        ? calculationContext.emergency_category
        : null;
    const afterHoursVisit =
      calculationContext.after_hours_visit === 'night' ||
      calculationContext.after_hours_visit === 'holiday' ||
      calculationContext.after_hours_visit === 'midnight'
        ? calculationContext.after_hours_visit
        : null;
    const careLevelCategory =
      calculationContext.care_level_category === 'care_required' ||
      calculationContext.care_level_category === 'support_required'
        ? calculationContext.care_level_category
        : null;
    const facilityStandards = readFacilityStandards(calculationContext);

    const visitRecordId =
      typeof evidence.visit_record_id === 'string' ? evidence.visit_record_id : null;
    const specs = await buildBillingCandidateSpecs(db, {
      orgId: args.orgId,
      asOfDate: (visitRecordId ? visitDateByRecordId.get(visitRecordId) : undefined) ?? monthStart,
      payerBasis: toPayerBasis(evidence.payer_basis),
      serviceType:
        evidence.billing_service_type === 'care_home_management'
          ? 'care_home_management'
          : 'medical_home_visit',
      providerScope: evidence.provider_scope === 'hospital_clinic' ? 'hospital_clinic' : 'pharmacy',
      buildingPatientCount: evidence.building_patient_count ?? 1,
      monthlyVisitCount: evidence.monthly_count_snapshot ?? 0,
      weeklyVisitCount: evidence.weekly_count_snapshot ?? 0,
      claimable: evidence.claimable,
      exclusionReason: evidence.exclusion_reason,
      specialCapEligible: calculationContext.special_cap_eligible === true,
      onlineEligible: calculationContext.online_eligible === true,
      regionAddOnEligible,
      visitType:
        typeof calculationContext.visit_type === 'string' ? calculationContext.visit_type : null,
      emergencyCategory,
      afterHoursVisit,
      infantEligible: calculationContext.infant_eligible === true,
      pediatricAge: calculationContext.pediatric_age === true,
      narcoticRequired: calculationContext.narcotic_required === true,
      narcoticInjectionRequired: calculationContext.narcotic_injection_required === true,
      centralVenousRequired: calculationContext.central_venous_required === true,
      enteralRequired: calculationContext.enteral_required === true,
      careLevelCategory,
      facilityStandards,
    });

    for (const spec of specs) {
      const dedupeKey = `${monthStart.toISOString().slice(0, 10)}:${evidence.id}:${spec.code}`;
      const existing = existingByKey.get(dedupeKey);
      const existingWorkflow = readBillingCandidateWorkflowState(existing?.source_snapshot);
      const preservedStatus = resolveRegeneratedCandidateStatus(existing, spec.status);
      const preservedExclusionReason =
        preservedStatus === 'excluded' ? (existingWorkflow.note ?? spec.exclusionReason) : null;
      const calculationBreakdown = normalizedJsonObject(spec.calculationBreakdown);
      const sourceSnapshot = writeBillingCandidateWorkflowState(
        normalizedJsonObject(
          mergeCandidateSourceSnapshot({
            sourceSnapshot: spec.sourceSnapshot,
            calculationContext: evidence.calculation_context,
            candidateStatus: preservedStatus,
            claimable: evidence.claimable,
            evidenceMessage: evidence.claimable
              ? '同意・管理計画書・報告送付を満たしています'
              : (evidence.exclusion_reason ?? '請求根拠の確認が必要です'),
            ruleMessage:
              spec.exclusionReason ??
              (preservedStatus === 'candidate'
                ? '算定候補のため月次レビューで確定してください'
                : 'SSOTルールに適合しています'),
            workflow: existingWorkflow,
          }),
        ),
        existingWorkflow,
      );

      const candidate = await persistRegeneratedBillingCandidate(db, {
        orgId: args.orgId,
        dedupeKey,
        existing,
        create: {
          org_id: args.orgId,
          patient_id: evidence.patient_id,
          billing_domain: 'home_care',
          billing_target_type: 'patient',
          billing_target_id: evidence.patient_id,
          billing_target_name: null,
          cycle_id: evidence.cycle_id ?? null,
          evidence_id: evidence.id,
          rule_id: ruleIdByKey.get(spec.ssotKey) ?? null,
          dedupe_key: dedupeKey,
          billing_month: monthStart,
          billing_code: spec.code,
          billing_name: spec.name,
          points: spec.points,
          quantity: 1,
          calculation_breakdown: calculationBreakdown,
          source_snapshot: sourceSnapshot,
          status: preservedStatus,
          exclusion_reason: preservedExclusionReason,
        },
        updateScope: {
          billing_month: monthStart,
          billing_domain: 'home_care',
        },
        update: {
          evidence_id: evidence.id,
          billing_domain: 'home_care',
          billing_target_type: 'patient',
          billing_target_id: evidence.patient_id,
          billing_target_name: null,
          cycle_id: evidence.cycle_id ?? null,
          rule_id: ruleIdByKey.get(spec.ssotKey) ?? null,
          billing_name: spec.name,
          points: spec.points,
          quantity: 1,
          calculation_breakdown: calculationBreakdown,
          source_snapshot: sourceSnapshot,
          status: preservedStatus,
          exclusion_reason: preservedExclusionReason,
        },
      });

      created.push(candidate);
    }
  }

  if (blockedEvidenceIds.length > 0) {
    await db.billingCandidate.deleteMany({
      where: {
        org_id: args.orgId,
        billing_month: monthStart,
        billing_domain: 'home_care',
        evidence_id: { in: blockedEvidenceIds },
        status: 'candidate',
      },
    });
  }

  const [informationProvisionCandidates, homeDuplicateInteractionCandidates] = await Promise.all([
    generateInformationProvisionCandidates(db, {
      orgId: args.orgId,
      billingMonth: monthStart,
      ruleIdByKey,
      existingByKey,
      claimableEvidenceByPatient,
    }),
    generateHomeDuplicateInteractionCandidates(db, {
      orgId: args.orgId,
      billingMonth: monthStart,
      ruleIdByKey,
      existingByKey,
    }),
  ]);

  return [...created, ...informationProvisionCandidates, ...homeDuplicateInteractionCandidates];
}
