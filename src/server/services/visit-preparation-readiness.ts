import type { Prisma } from '@prisma/client';
import {
  listBillingEvidenceBlockers,
  type BillingEvidenceBlocker,
  type BillingEvidenceBlockersReader,
} from './billing-evidence';
import { evaluateVisitWorkflowGate } from './management-plans';

type ReadyTransitionDb = Pick<
  Prisma.TransactionClient,
  | 'consentRecord'
  | 'firstVisitDocument'
  | 'managementPlan'
  | 'medicationCycle'
  | 'visitRecord'
  | 'visitSchedule'
> &
  BillingEvidenceBlockersReader;

type VisitReadyPreparation = {
  org_id: string;
  medication_changes_reviewed: boolean;
  carry_items_confirmed: boolean;
  previous_issues_reviewed: boolean;
  route_confirmed: boolean;
  offline_synced: boolean;
} | null;

type VisitReadyOnboardingKey =
  | 'consent_obtained'
  | 'emergency_contact_set'
  | 'first_visit_doc_delivered'
  | 'management_plan_approved'
  | 'primary_physician_set';

type VisitReadyOnboardingBlocker = {
  key: VisitReadyOnboardingKey;
  label: string;
};

type VisitReadyBillingBlocker = BillingEvidenceBlocker & {
  evidence_id: string;
  visit_record_id: string | null;
};

export type VisitReadyTransitionBlockers = {
  readiness_blockers: string[];
  onboarding_blockers: VisitReadyOnboardingBlocker[];
  billing_blockers: VisitReadyBillingBlocker[];
};

export type VisitReadyTransitionResult =
  | { ok: true }
  | { ok: false; details: VisitReadyTransitionBlockers };

const PREPARATION_READY_ITEMS = [
  ['medication_changes_reviewed', '薬歴・前回変更の確認'],
  ['carry_items_confirmed', '持参薬・物品確認'],
  ['previous_issues_reviewed', '前回課題の確認'],
  ['route_confirmed', 'ルート確認'],
  ['offline_synced', 'オフライン同期確認'],
] as const satisfies ReadonlyArray<readonly [keyof NonNullable<VisitReadyPreparation>, string]>;

const ONBOARDING_READY_ITEMS = [
  ['consent_obtained', '同意未取得'],
  ['emergency_contact_set', '緊急連絡先未登録'],
  ['first_visit_doc_delivered', '初回文書未交付'],
  ['management_plan_approved', '管理計画未承認'],
  ['primary_physician_set', '主治医未設定'],
] as const satisfies ReadonlyArray<readonly [VisitReadyOnboardingKey, string]>;

export const VISIT_READY_CHECKLIST_BLOCKED_MESSAGE =
  '訪問準備チェックリストが未完了のため ready へ進めません';

export const VISIT_READY_CONTEXT_BLOCKED_MESSAGE =
  '訪問準備に未解決のブロッカーがあるため ready へ進めません';

export const VISIT_READY_CARRY_ITEMS_STATUS_BLOCKER = '持参物ステータス未解決';

function buildReadinessBlockers(preparation: VisitReadyPreparation) {
  const blockers = PREPARATION_READY_ITEMS.flatMap(([field, label]) =>
    preparation?.[field] ? [] : [label],
  );
  return blockers;
}

function buildOnboardingBlockers(readiness: Record<VisitReadyOnboardingKey, boolean>) {
  return ONBOARDING_READY_ITEMS.flatMap(([key, label]) => (readiness[key] ? [] : [{ key, label }]));
}

function isPrimaryPhysicianRole(role: string) {
  return ['physician', 'doctor', 'clinic', 'prescriber'].includes(role);
}

export function getVisitReadyTransitionErrorMessage(details: VisitReadyTransitionBlockers) {
  if (details.onboarding_blockers.length === 0 && details.billing_blockers.length === 0) {
    return VISIT_READY_CHECKLIST_BLOCKED_MESSAGE;
  }
  return VISIT_READY_CONTEXT_BLOCKED_MESSAGE;
}

export async function evaluateVisitScheduleReadyTransition(
  db: ReadyTransitionDb,
  args: { orgId: string; scheduleId: string },
): Promise<VisitReadyTransitionResult> {
  const schedule = await db.visitSchedule.findFirst({
    where: {
      org_id: args.orgId,
      id: args.scheduleId,
      case_: {
        org_id: args.orgId,
        patient: {
          org_id: args.orgId,
        },
      },
    },
    select: {
      id: true,
      case_id: true,
      carry_items_status: true,
      scheduled_date: true,
      preparation: {
        select: {
          org_id: true,
          medication_changes_reviewed: true,
          carry_items_confirmed: true,
          previous_issues_reviewed: true,
          route_confirmed: true,
          offline_synced: true,
        },
      },
      case_: {
        select: {
          patient: {
            select: {
              id: true,
              org_id: true,
              contacts: {
                where: { org_id: args.orgId, is_emergency_contact: true },
                select: { id: true },
              },
            },
          },
          care_team_links: {
            where: { org_id: args.orgId },
            select: { role: true },
          },
        },
      },
    },
  });

  if (!schedule) {
    return {
      ok: false,
      details: {
        readiness_blockers: ['訪問予定が見つかりません'],
        onboarding_blockers: [],
        billing_blockers: [],
      },
    };
  }

  const preparation = schedule.preparation?.org_id === args.orgId ? schedule.preparation : null;

  const [workflowGate, firstVisitDoc, scopedVisitRecords, scopedMedicationCycles] =
    await Promise.all([
      evaluateVisitWorkflowGate(db, {
        orgId: args.orgId,
        patientId: schedule.case_.patient.id,
        caseId: schedule.case_id,
        asOf: schedule.scheduled_date,
      }),
      db.firstVisitDocument.findFirst({
        where: {
          org_id: args.orgId,
          case_id: schedule.case_id,
        },
        orderBy: { created_at: 'desc' },
        select: {
          id: true,
          delivered_at: true,
        },
      }),
      db.visitRecord.findMany({
        where: {
          org_id: args.orgId,
          patient_id: schedule.case_.patient.id,
          schedule: {
            org_id: args.orgId,
            case_id: schedule.case_id,
          },
        },
        select: { id: true },
      }),
      db.medicationCycle.findMany({
        where: {
          org_id: args.orgId,
          patient_id: schedule.case_.patient.id,
          case_id: schedule.case_id,
        },
        select: { id: true },
      }),
    ]);

  const billingEvidence = await listBillingEvidenceBlockers(db, {
    orgId: args.orgId,
    patientId: schedule.case_.patient.id,
    visitRecordIds: scopedVisitRecords.map((item) => item.id),
    cycleIds: scopedMedicationCycles.map((item) => item.id),
    limit: 4,
  });
  const billingBlockers = billingEvidence.flatMap((item) =>
    item.blockers.map((blocker) => ({
      evidence_id: item.id,
      visit_record_id: item.visit_record_id,
      ...blocker,
    })),
  );

  const onboardingReadiness = {
    consent_obtained: !workflowGate.issues.includes('missing_visit_consent'),
    emergency_contact_set: schedule.case_.patient.contacts.length > 0,
    first_visit_doc_delivered: firstVisitDoc?.delivered_at != null,
    management_plan_approved: !workflowGate.issues.some(
      (issue) => issue === 'missing_management_plan' || issue === 'management_plan_review_overdue',
    ),
    primary_physician_set: schedule.case_.care_team_links.some((link) =>
      isPrimaryPhysicianRole(link.role),
    ),
  } satisfies Record<VisitReadyOnboardingKey, boolean>;

  const details = {
    readiness_blockers: [
      ...buildReadinessBlockers(preparation),
      ...(['blocked', 'partial'].includes(schedule.carry_items_status ?? '')
        ? [VISIT_READY_CARRY_ITEMS_STATUS_BLOCKER]
        : []),
    ],
    onboarding_blockers: buildOnboardingBlockers(onboardingReadiness),
    billing_blockers: billingBlockers,
  } satisfies VisitReadyTransitionBlockers;

  if (
    details.readiness_blockers.length === 0 &&
    details.onboarding_blockers.length === 0 &&
    details.billing_blockers.length === 0
  ) {
    return { ok: true };
  }

  return { ok: false, details };
}
