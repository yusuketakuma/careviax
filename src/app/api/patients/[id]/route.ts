import { format } from 'date-fns';
import { NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { normalizeJsonInput, readJsonObject } from '@/lib/db/json';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { success, validationError, notFound } from '@/lib/api/response';
import { updatePatientSchema, type UpdatePatientData } from '@/lib/validations/patient';
import { prisma } from '@/lib/db/client';
import { Prisma } from '@prisma/client';
import {
  assertFacilityReference,
  assertFacilityUnitReference,
  FacilityReferenceValidationError,
  FacilityUnitReferenceValidationError,
  getFacilityVisitDefaults,
} from '@/lib/patient/facility-reference';
import {
  getPatientPrivacyFlags,
  maskAddressDetail,
  maskContactValue,
  maskInsuranceNumber,
  maskPhoneNumber,
} from '@/lib/patient/privacy';
import { listCommunicationQueue } from '@/server/services/communication-queue';
import { listBillingEvidenceBlockers } from '@/server/services/billing-evidence';
import { getPatientHomeCareFeatureSummary } from '@/server/services/home-care-ops';
import { getPatientRiskSummary } from '@/server/services/patient-risk';
import { getPatientVisitBrief } from '@/server/services/visit-brief';
import { batchResolveNames } from '@/lib/utils/name-resolver';
import { localDateKey, utcDateFromLocalKey } from '@/lib/utils/date-boundary';
import {
  CHANNEL_LABELS,
  PRIORITY_LABELS,
  REPORT_STATUS_CONFIG,
  REPORT_TYPE_LABELS,
  SCHEDULE_STATUS_LABELS,
  VISIT_OUTCOME_LABELS,
} from '@/lib/constants/status-labels';
import { getHomeVisitIntake, type HomeVisitIntake } from '@/lib/patient/home-visit-intake';
import { KEY_LAB_ANALYTE_CODES } from '@/lib/patient/lab-analytes';
import { CYCLE_STATUS_LABELS } from '@/lib/prescription/cycle-workspace';
import {
  buildAssignedCareCaseWhere,
  buildCareReportCaseScope,
  buildNullableCaseScope,
  buildPatientDetailWhere,
  buildVisitRecordCaseScope,
} from '@/server/services/patient-detail-scope';
import {
  buildExternalAccessGrantVisibilityWhere,
  toPublicExternalAccessScope,
} from '@/server/services/external-access';

type FirstVisitDocumentContact = {
  id?: string;
  name: string;
  relation: string | null;
  phone: string | null;
  email: string | null;
  fax: string | null;
  organization_name: string | null;
  department: string | null;
  is_primary: boolean;
  is_emergency_contact: boolean;
};

function isInputJsonObject(
  value: Prisma.InputJsonValue | null | undefined,
): value is Prisma.InputJsonObject {
  return (
    typeof value === 'object' && value !== null && !Array.isArray(value) && !('toJSON' in value)
  );
}

function normalizeInputJsonObject(value: unknown): Prisma.InputJsonObject {
  const normalized = normalizeJsonInput(value);
  return isInputJsonObject(normalized) ? normalized : {};
}

function normalizeFirstVisitDocumentContacts(
  value: Prisma.JsonValue | null | undefined,
): FirstVisitDocumentContact[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    const record = readJsonObject(item);
    if (!record) return [];

    const name = typeof record.name === 'string' ? record.name : null;
    if (!name) return [];

    return [
      {
        id: typeof record.id === 'string' ? record.id : undefined,
        name,
        relation: typeof record.relation === 'string' ? record.relation : null,
        phone: typeof record.phone === 'string' ? record.phone : null,
        email: typeof record.email === 'string' ? record.email : null,
        fax: typeof record.fax === 'string' ? record.fax : null,
        organization_name:
          typeof record.organization_name === 'string' ? record.organization_name : null,
        department: typeof record.department === 'string' ? record.department : null,
        is_primary: record.is_primary === true,
        is_emergency_contact: record.is_emergency_contact === true,
      },
    ];
  });
}

const PRESCRIPTION_SOURCE_LABELS: Record<string, string> = {
  paper: '紙処方箋',
  fax: 'FAX',
  e_prescription: '電子処方箋',
  facility_batch: '施設一括',
  refill: 'リフィル',
  qr_scan: 'QR取込',
};

const MANAGEMENT_PLAN_STATUS_LABELS: Record<string, string> = {
  draft: '下書き',
  approved: '承認済み',
};

const SELF_REPORT_STATUS_LABELS: Record<string, string> = {
  submitted: '未対応',
  triaged: 'トリアージ済み',
  converted_to_task: 'タスク化済み',
  resolved: '解決済み',
  dismissed: '対応不要',
};

const CARRY_TYPE_LABELS: Record<string, string> = {
  carry: '持参',
  facility_deposit: '施設預け',
  deferred: '後送',
};

const VISIT_TYPE_LABELS: Record<string, string> = {
  initial: '初回訪問',
  regular: '定期訪問',
  temporary: '臨時訪問',
  revisit: '再訪問',
  delivery_only: '配薬のみ',
  emergency: '緊急訪問',
  physician_co_visit: '同行訪問',
};

function formatTimelineDate(value: Date | null | undefined) {
  return value ? format(value, 'yyyy/MM/dd') : null;
}

function compactTimelineValues(values: Array<string | null | undefined | false>) {
  return values.filter((value): value is string => Boolean(value && value.trim()));
}

function previewTimelineText(value: string | null | undefined, maxLength = 96) {
  const normalized = value?.replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
}

function getCommunicationDirectionLabel(direction: string) {
  if (direction === 'inbound' || direction === 'incoming') return '受信';
  if (direction === 'outbound' || direction === 'outgoing') return '発信';
  return direction;
}

const OPEN_CASE_STATUSES = ['referral_received', 'assessment', 'active', 'on_hold'] as const;

type PatientRequesterPatch = NonNullable<UpdatePatientData['requester']>;
type PatientIntakePatch = NonNullable<UpdatePatientData['intake']>;
const PATIENT_EXTERNAL_SHARE_LIMIT = 8;

async function listVisibleExternalSharesForPatient(args: {
  orgId: string;
  patientId: string;
  caseIds: string[];
}) {
  return prisma.externalAccessGrant.findMany({
    where: {
      org_id: args.orgId,
      patient_id: args.patientId,
      revoked_at: null,
      ...buildExternalAccessGrantVisibilityWhere(args.caseIds),
    },
    orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
    take: PATIENT_EXTERNAL_SHARE_LIMIT,
    select: {
      id: true,
      granted_to_name: true,
      granted_to_contact: true,
      scope: true,
      expires_at: true,
      accessed_at: true,
      created_at: true,
    },
  });
}

async function listBillingCaseRefs(args: { orgId: string; patientId: string; caseIds: string[] }) {
  if (args.caseIds.length === 0) {
    return { visitRecordIds: [] as string[], cycleIds: [] as string[] };
  }

  const [visitRecords, cycles] = await Promise.all([
    prisma.visitRecord.findMany({
      where: {
        org_id: args.orgId,
        patient_id: args.patientId,
        ...buildVisitRecordCaseScope(args.caseIds),
      },
      select: { id: true },
    }),
    prisma.medicationCycle.findMany({
      where: {
        org_id: args.orgId,
        patient_id: args.patientId,
        case_id: { in: args.caseIds },
      },
      select: { id: true },
    }),
  ]);

  return {
    visitRecordIds: visitRecords.map((item) => item.id),
    cycleIds: cycles.map((item) => item.id),
  };
}

function hasOwnKey<T extends object>(value: T, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function normalizeNullableText(value: string | null | undefined) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function assignOptionalField(target: object, key: string, value: unknown | undefined) {
  const targetRecord = target as Record<string, unknown>;
  if (value === undefined) {
    delete targetRecord[key];
    return;
  }
  targetRecord[key] = value;
}

function assignTextField(
  target: object,
  key: string,
  value: string | null | undefined,
  provided: boolean,
) {
  if (!provided) return;
  const normalized = normalizeNullableText(value);
  assignOptionalField(target, key, normalized);
}

function assignBooleanField(
  target: object,
  key: string,
  value: boolean | undefined,
  provided: boolean,
) {
  if (!provided) return;
  assignOptionalField(target, key, value);
}

function assignNumberField(
  target: object,
  key: string,
  value: number | undefined,
  provided: boolean,
) {
  if (!provided) return;
  assignOptionalField(
    target,
    key,
    typeof value === 'number' && Number.isFinite(value) ? value : undefined,
  );
}

function assignArrayField(
  target: object,
  key: string,
  value: string[] | undefined,
  provided: boolean,
) {
  if (!provided) return;
  assignOptionalField(target, key, Array.isArray(value) ? value : undefined);
}

function compactNestedObject<T extends object>(value: T) {
  const entries = Object.entries(value).filter(([, entry]) => entry !== undefined);
  return entries.length > 0 ? (Object.fromEntries(entries) as T) : undefined;
}

function mergeHomeVisitIntake(args: {
  current: HomeVisitIntake | null;
  requester?: PatientRequesterPatch;
  intake?: PatientIntakePatch;
}) {
  const next: HomeVisitIntake = { ...(args.current ?? {}) };

  if (args.requester) {
    const requester = { ...(next.requester ?? {}) };
    assignTextField(
      requester,
      'organization_name',
      args.requester.organization_name,
      hasOwnKey(args.requester, 'organization_name'),
    );
    assignTextField(
      requester,
      'profession',
      args.requester.profession,
      hasOwnKey(args.requester, 'profession'),
    );
    assignTextField(
      requester,
      'contact_name',
      args.requester.contact_name,
      hasOwnKey(args.requester, 'contact_name'),
    );
    assignTextField(
      requester,
      'contact_name_kana',
      args.requester.contact_name_kana,
      hasOwnKey(args.requester, 'contact_name_kana'),
    );
    assignTextField(requester, 'phone', args.requester.phone, hasOwnKey(args.requester, 'phone'));
    assignTextField(requester, 'fax', args.requester.fax, hasOwnKey(args.requester, 'fax'));
    assignTextField(
      requester,
      'pharmacy_decision_due_date',
      args.requester.pharmacy_decision_due_date,
      hasOwnKey(args.requester, 'pharmacy_decision_due_date'),
    );
    assignTextField(
      requester,
      'preferred_contact_method',
      args.requester.preferred_contact_method,
      hasOwnKey(args.requester, 'preferred_contact_method'),
    );
    assignTextField(
      requester,
      'preferred_contact_method_other',
      args.requester.preferred_contact_method_other,
      hasOwnKey(args.requester, 'preferred_contact_method_other'),
    );
    next.requester = compactNestedObject(requester);
  }

  if (args.intake) {
    assignNumberField(next, 'reported_age', args.intake.age, hasOwnKey(args.intake, 'age'));
    assignTextField(
      next,
      'primary_disease',
      args.intake.primary_disease,
      hasOwnKey(args.intake, 'primary_disease'),
    );
    assignTextField(
      next,
      'postal_code',
      args.intake.postal_code,
      hasOwnKey(args.intake, 'postal_code'),
    );
    assignTextField(
      next,
      'housing_type',
      args.intake.housing_type,
      hasOwnKey(args.intake, 'housing_type'),
    );
    assignTextField(
      next,
      'facility_name',
      args.intake.facility_name,
      hasOwnKey(args.intake, 'facility_name'),
    );
    assignBooleanField(
      next,
      'mcs_linked',
      args.intake.mcs_linked,
      hasOwnKey(args.intake, 'mcs_linked'),
    );
    assignTextField(
      next,
      'primary_contact_preference',
      args.intake.primary_contact_preference,
      hasOwnKey(args.intake, 'primary_contact_preference'),
    );
    assignTextField(
      next,
      'contact_phone',
      args.intake.contact_phone,
      hasOwnKey(args.intake, 'contact_phone'),
    );
    assignTextField(
      next,
      'contact_mobile',
      args.intake.contact_mobile,
      hasOwnKey(args.intake, 'contact_mobile'),
    );
    assignBooleanField(
      next,
      'visit_before_contact_required',
      args.intake.visit_before_contact_required,
      hasOwnKey(args.intake, 'visit_before_contact_required'),
    );
    assignTextField(
      next,
      'first_visit_date',
      args.intake.first_visit_preferred_date,
      hasOwnKey(args.intake, 'first_visit_preferred_date'),
    );
    assignTextField(
      next,
      'first_visit_time_slot',
      args.intake.first_visit_time_slot,
      hasOwnKey(args.intake, 'first_visit_time_slot'),
    );
    assignTextField(
      next,
      'first_visit_time_note',
      args.intake.first_visit_time_note,
      hasOwnKey(args.intake, 'first_visit_time_note'),
    );
    assignTextField(
      next,
      'money_management',
      args.intake.money_management,
      hasOwnKey(args.intake, 'money_management'),
    );
    assignBooleanField(
      next,
      'parking_available',
      args.intake.parking_available,
      hasOwnKey(args.intake, 'parking_available'),
    );
    assignTextField(
      next,
      'family_key_person',
      args.intake.family_key_person,
      hasOwnKey(args.intake, 'family_key_person'),
    );
    assignTextField(
      next,
      'care_level',
      args.intake.care_level,
      hasOwnKey(args.intake, 'care_level'),
    );
    assignTextField(next, 'adl_level', args.intake.adl_level, hasOwnKey(args.intake, 'adl_level'));
    assignTextField(
      next,
      'dementia_level',
      args.intake.dementia_level,
      hasOwnKey(args.intake, 'dementia_level'),
    );
    assignArrayField(
      next,
      'medication_support_methods',
      args.intake.medication_support_methods,
      hasOwnKey(args.intake, 'medication_support_methods'),
    );
    assignTextField(
      next,
      'medication_support_other',
      args.intake.medication_support_other,
      hasOwnKey(args.intake, 'medication_support_other'),
    );
    assignBooleanField(
      next,
      'ent_prescription',
      args.intake.ent_prescription,
      hasOwnKey(args.intake, 'ent_prescription'),
    );
    assignTextField(
      next,
      'ent_period_from',
      args.intake.ent_period_from,
      hasOwnKey(args.intake, 'ent_period_from'),
    );
    assignTextField(
      next,
      'ent_period_to',
      args.intake.ent_period_to,
      hasOwnKey(args.intake, 'ent_period_to'),
    );
    assignBooleanField(
      next,
      'narcotics_base',
      args.intake.narcotics_base,
      hasOwnKey(args.intake, 'narcotics_base'),
    );
    assignBooleanField(
      next,
      'narcotics_rescue',
      args.intake.narcotics_rescue,
      hasOwnKey(args.intake, 'narcotics_rescue'),
    );
    assignTextField(
      next,
      'allergy_history',
      args.intake.allergy_history,
      hasOwnKey(args.intake, 'allergy_history'),
    );
    assignTextField(
      next,
      'infection_isolation',
      args.intake.infection_isolation,
      hasOwnKey(args.intake, 'infection_isolation'),
    );
    assignTextField(
      next,
      'swallowing_route',
      args.intake.swallowing_route,
      hasOwnKey(args.intake, 'swallowing_route'),
    );
    assignTextField(
      next,
      'residual_medication_status',
      args.intake.residual_medication_status,
      hasOwnKey(args.intake, 'residual_medication_status'),
    );
    assignTextField(
      next,
      'other_clinical_notes',
      args.intake.other_clinical_notes,
      hasOwnKey(args.intake, 'other_clinical_notes'),
    );
    assignArrayField(
      next,
      'special_medical_procedures',
      args.intake.special_medical_procedures,
      hasOwnKey(args.intake, 'special_medical_procedures'),
    );
    assignTextField(
      next,
      'special_medical_notes',
      args.intake.special_medical_notes,
      hasOwnKey(args.intake, 'special_medical_notes'),
    );
    assignTextField(
      next,
      'intake_note',
      args.intake.intake_note,
      hasOwnKey(args.intake, 'intake_note'),
    );
    assignBooleanField(
      next,
      'initial_transition_management_expected',
      args.intake.initial_transition_management_expected,
      hasOwnKey(args.intake, 'initial_transition_management_expected'),
    );

    if (hasOwnKey(args.intake, 'emergency_contact')) {
      const emergencyContact = { ...(next.emergency_contact ?? {}) };
      const value = args.intake.emergency_contact;
      if (value) {
        assignTextField(emergencyContact, 'name', value.name, hasOwnKey(value, 'name'));
        assignTextField(emergencyContact, 'relation', value.relation, hasOwnKey(value, 'relation'));
        assignTextField(emergencyContact, 'phone', value.phone, hasOwnKey(value, 'phone'));
      } else {
        delete next.emergency_contact;
      }
      if (value) next.emergency_contact = compactNestedObject(emergencyContact);
    }

    if (hasOwnKey(args.intake, 'care_manager')) {
      const careManager = { ...(next.care_manager ?? {}) };
      const value = args.intake.care_manager;
      if (value) {
        assignTextField(careManager, 'name', value.name, hasOwnKey(value, 'name'));
        assignTextField(careManager, 'name_kana', value.name_kana, hasOwnKey(value, 'name_kana'));
        assignTextField(
          careManager,
          'organization_name',
          value.organization_name,
          hasOwnKey(value, 'organization_name'),
        );
        assignTextField(careManager, 'phone', value.phone, hasOwnKey(value, 'phone'));
        assignTextField(careManager, 'fax', value.fax, hasOwnKey(value, 'fax'));
      } else {
        delete next.care_manager;
      }
      if (value) next.care_manager = compactNestedObject(careManager);
    }

    if (hasOwnKey(args.intake, 'visiting_nurse')) {
      const visitingNurse = { ...(next.visiting_nurse ?? {}) };
      const value = args.intake.visiting_nurse;
      if (value) {
        assignTextField(visitingNurse, 'name', value.name, hasOwnKey(value, 'name'));
        assignTextField(visitingNurse, 'name_kana', value.name_kana, hasOwnKey(value, 'name_kana'));
        assignTextField(
          visitingNurse,
          'organization_name',
          value.organization_name,
          hasOwnKey(value, 'organization_name'),
        );
        assignTextField(visitingNurse, 'phone', value.phone, hasOwnKey(value, 'phone'));
        assignTextField(visitingNurse, 'fax', value.fax, hasOwnKey(value, 'fax'));
      } else {
        delete next.visiting_nurse;
      }
      if (value) next.visiting_nurse = compactNestedObject(visitingNurse);
    }
  }

  const entries = Object.entries(next).filter(([, value]) => value !== undefined);
  return entries.length > 0 ? (Object.fromEntries(entries) as HomeVisitIntake) : null;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '患者情報の閲覧権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;

  const { id: rawId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return validationError('患者IDが不正です');

  const assignedCareCaseWhere = buildAssignedCareCaseWhere(ctx);

  const patient = await prisma.patient.findFirst({
    where: buildPatientDetailWhere({
      orgId: ctx.orgId,
      patientId: id,
      role: ctx.role,
      userId: ctx.userId,
    }),
    include: {
      residences: true,
      cases: {
        ...(assignedCareCaseWhere ? { where: assignedCareCaseWhere } : {}),
        orderBy: { created_at: 'desc' },
        include: {
          care_team_links: true,
        },
      },
      contacts: true,
      conditions: {
        orderBy: [{ is_primary: 'desc' }, { created_at: 'asc' }],
      },
      consents: true,
    },
  });

  if (!patient) return notFound('患者が見つかりません');

  const caseIds = (patient.cases ?? []).map((item) => item.id);
  const billingRefs = await listBillingCaseRefs({
    orgId: ctx.orgId,
    patientId: id,
    caseIds,
  });
  const billingEvidenceScope =
    billingRefs.visitRecordIds.length === 0 && billingRefs.cycleIds.length === 0
      ? { id: { in: [] } }
      : {
          OR: [
            { visit_record_id: { in: billingRefs.visitRecordIds } },
            { cycle_id: { in: billingRefs.cycleIds } },
          ],
        };
  const billingCandidateScope =
    billingRefs.cycleIds.length === 0
      ? { id: { in: [] } }
      : { cycle_id: { in: billingRefs.cycleIds } };
  // scheduled_date(@db.Date)比較用: ローカル今月の月初/翌月初を UTC 深夜で表す
  const todayKey = localDateKey();
  const [currentYear, currentMonth] = todayKey.split('-').map(Number);
  const currentMonthStart = utcDateFromLocalKey(
    `${currentYear}-${`${currentMonth}`.padStart(2, '0')}-01`,
  );
  const nextMonthStart = new Date(
    Date.UTC(currentYear, currentMonth, 1), // monthIndex = currentMonth で翌月 1 日
  );

  const [
    currentMedications,
    visitSchedules,
    currentMonthVisitCount,
    visitRecords,
    careReports,
    communicationEvents,
    selfReports,
    externalShares,
    openTasks,
    medicationIssues,
    inquiryRecords,
    prescriptionIntakes,
    dispenseResults,
    managementPlans,
    billingEvidence,
    billingEvidenceBlockers,
    billingCandidates,
    communicationQueue,
    riskSummary,
    visitBrief,
    firstVisitDocuments,
  ] = await Promise.all([
    prisma.medicationProfile.findMany({
      where: {
        org_id: ctx.orgId,
        patient_id: id,
        is_current: true,
      },
      orderBy: [{ created_at: 'desc' }],
      take: 20,
      select: {
        id: true,
        drug_name: true,
        dose: true,
        frequency: true,
        start_date: true,
        end_date: true,
        prescriber: true,
        is_current: true,
        source: true,
        created_at: true,
      },
    }),
    caseIds.length === 0
      ? Promise.resolve([])
      : prisma.visitSchedule.findMany({
          where: {
            org_id: ctx.orgId,
            case_id: { in: caseIds },
          },
          orderBy: [{ scheduled_date: 'desc' }, { time_window_start: 'desc' }],
          take: 12,
          select: {
            id: true,
            case_id: true,
            visit_type: true,
            scheduled_date: true,
            time_window_start: true,
            time_window_end: true,
            schedule_status: true,
            priority: true,
            pharmacist_id: true,
            assignment_mode: true,
            confirmed_at: true,
            route_order: true,
            created_at: true,
            updated_at: true,
            visit_record: {
              select: {
                id: true,
                outcome_status: true,
                visit_date: true,
                next_visit_suggestion_date: true,
                created_at: true,
              },
            },
          },
        }),
    caseIds.length === 0
      ? Promise.resolve(0)
      : prisma.visitSchedule.count({
          where: {
            org_id: ctx.orgId,
            case_id: { in: caseIds },
            scheduled_date: {
              gte: currentMonthStart,
              lt: nextMonthStart,
            },
          },
        }),
    caseIds.length === 0
      ? Promise.resolve([])
      : prisma.visitRecord.findMany({
          where: {
            org_id: ctx.orgId,
            patient_id: id,
            ...buildVisitRecordCaseScope(caseIds),
          },
          orderBy: [{ visit_date: 'desc' }, { created_at: 'desc' }],
          take: 12,
          select: {
            id: true,
            schedule_id: true,
            pharmacist_id: true,
            visit_date: true,
            outcome_status: true,
            next_visit_suggestion_date: true,
            cancellation_reason: true,
            postpone_reason: true,
            revisit_reason: true,
            created_at: true,
          },
        }),
    prisma.careReport.findMany({
      where: {
        org_id: ctx.orgId,
        patient_id: id,
        ...buildCareReportCaseScope(caseIds),
      },
      orderBy: [{ created_at: 'desc' }],
      take: 8,
      select: {
        id: true,
        report_type: true,
        status: true,
        created_by: true,
        created_at: true,
        delivery_records: {
          orderBy: [{ created_at: 'desc' }],
          take: 4,
          select: {
            id: true,
            channel: true,
            recipient_name: true,
            status: true,
            sent_at: true,
            confirmed_at: true,
            created_at: true,
          },
        },
      },
    }),
    prisma.communicationEvent.findMany({
      where: {
        org_id: ctx.orgId,
        patient_id: id,
        ...buildNullableCaseScope(caseIds),
      },
      orderBy: [{ occurred_at: 'desc' }],
      take: 8,
      select: {
        id: true,
        event_type: true,
        channel: true,
        direction: true,
        subject: true,
        counterpart_name: true,
        occurred_at: true,
      },
    }),
    prisma.patientSelfReport.findMany({
      where: {
        org_id: ctx.orgId,
        patient_id: id,
      },
      orderBy: [{ created_at: 'desc' }],
      take: 8,
      select: {
        id: true,
        subject: true,
        category: true,
        content: true,
        relation: true,
        status: true,
        reported_by_name: true,
        requested_callback: true,
        preferred_contact_time: true,
        created_at: true,
      },
    }),
    listVisibleExternalSharesForPatient({
      orgId: ctx.orgId,
      patientId: id,
      caseIds,
    }),
    prisma.task.findMany({
      where: {
        org_id: ctx.orgId,
        status: {
          in: ['pending', 'in_progress'],
        },
        OR: [
          {
            related_entity_type: 'patient',
            related_entity_id: id,
          },
          ...(caseIds.length > 0
            ? [
                {
                  related_entity_type: 'case',
                  related_entity_id: {
                    in: caseIds,
                  },
                },
              ]
            : []),
        ],
      },
      orderBy: [{ sla_due_at: 'asc' }, { due_date: 'asc' }, { created_at: 'asc' }],
      take: 8,
      select: {
        id: true,
        task_type: true,
        title: true,
        description: true,
        status: true,
        priority: true,
        due_date: true,
        sla_due_at: true,
        created_at: true,
      },
    }),
    prisma.medicationIssue.findMany({
      where: {
        org_id: ctx.orgId,
        patient_id: id,
        OR: [{ case_id: { in: caseIds } }, { case_id: null }],
        status: {
          in: ['open', 'in_progress'],
        },
      },
      orderBy: [{ priority: 'desc' }, { identified_at: 'desc' }],
      take: 6,
      select: {
        id: true,
        title: true,
        description: true,
        status: true,
        priority: true,
        category: true,
        identified_at: true,
      },
    }),
    caseIds.length === 0
      ? Promise.resolve([])
      : prisma.inquiryRecord.findMany({
          where: {
            org_id: ctx.orgId,
            cycle: {
              patient_id: id,
              case_id: { in: caseIds },
            },
          },
          orderBy: [{ resolved_at: 'desc' }, { inquired_at: 'desc' }, { created_at: 'desc' }],
          take: 8,
          select: {
            id: true,
            reason: true,
            inquiry_to_physician: true,
            inquiry_content: true,
            result: true,
            proposal_origin: true,
            residual_adjustment: true,
            change_detail: true,
            inquired_at: true,
            resolved_at: true,
            created_at: true,
            line: {
              select: {
                intake: {
                  select: {
                    id: true,
                  },
                },
              },
            },
          },
        }),
    caseIds.length === 0
      ? Promise.resolve([])
      : prisma.prescriptionIntake.findMany({
          where: {
            org_id: ctx.orgId,
            cycle: {
              patient_id: id,
              case_id: { in: caseIds },
            },
          },
          orderBy: [{ created_at: 'desc' }],
          take: 10,
          select: {
            id: true,
            source_type: true,
            prescribed_date: true,
            prescriber_name: true,
            prescriber_institution: true,
            original_collected_by: true,
            created_at: true,
            cycle: {
              select: {
                overall_status: true,
              },
            },
            lines: {
              take: 3,
              select: {
                id: true,
              },
            },
          },
        }),
    caseIds.length === 0
      ? Promise.resolve([])
      : prisma.dispenseResult.findMany({
          where: {
            org_id: ctx.orgId,
            line: {
              intake: {
                cycle: {
                  patient_id: id,
                  case_id: { in: caseIds },
                },
              },
            },
          },
          orderBy: [{ dispensed_at: 'desc' }],
          take: 12,
          select: {
            id: true,
            actual_drug_name: true,
            actual_quantity: true,
            actual_unit: true,
            carry_type: true,
            dispensed_by: true,
            dispensed_at: true,
            task: {
              select: {
                cycle: {
                  select: {
                    overall_status: true,
                  },
                },
              },
            },
            line: {
              select: {
                intake: {
                  select: {
                    id: true,
                  },
                },
              },
            },
          },
        }),
    caseIds.length === 0
      ? Promise.resolve([])
      : prisma.managementPlan.findMany({
          where: {
            org_id: ctx.orgId,
            case_id: {
              in: caseIds,
            },
          },
          orderBy: [{ updated_at: 'desc' }],
          take: 6,
          select: {
            id: true,
            status: true,
            title: true,
            effective_from: true,
            next_review_date: true,
            created_by: true,
            approved_by: true,
            approved_at: true,
            reviewed_by: true,
            reviewed_at: true,
            created_at: true,
          },
        }),
    prisma.billingEvidence.findMany({
      where: {
        org_id: ctx.orgId,
        patient_id: id,
        ...billingEvidenceScope,
      },
      orderBy: [{ billing_month: 'desc' }, { created_at: 'desc' }],
      take: 6,
      select: {
        id: true,
        billing_month: true,
        claimable: true,
        exclusion_reason: true,
        validation_notes: true,
      },
    }),
    listBillingEvidenceBlockers(prisma, {
      orgId: ctx.orgId,
      patientId: id,
      visitRecordIds: billingRefs.visitRecordIds,
      cycleIds: billingRefs.cycleIds,
      limit: 6,
    }),
    prisma.billingCandidate.findMany({
      where: {
        org_id: ctx.orgId,
        patient_id: id,
        ...billingCandidateScope,
      },
      orderBy: [{ billing_month: 'desc' }, { created_at: 'desc' }],
      take: 6,
      select: {
        id: true,
        billing_month: true,
        billing_code: true,
        billing_name: true,
        points: true,
        status: true,
        exclusion_reason: true,
      },
    }),
    listCommunicationQueue(prisma, {
      orgId: ctx.orgId,
      patientId: id,
      caseIds,
      limit: 6,
    }),
    getPatientRiskSummary(prisma, {
      orgId: ctx.orgId,
      patientId: id,
      caseIds,
    }),
    getPatientVisitBrief(prisma, {
      orgId: ctx.orgId,
      patientId: id,
      context: 'patient',
      caseIds,
    }),
    caseIds.length === 0
      ? Promise.resolve([])
      : prisma.firstVisitDocument.findMany({
          where: {
            org_id: ctx.orgId,
            patient_id: id,
            case_id: { in: caseIds },
          },
          orderBy: [{ created_at: 'desc' }],
          select: {
            id: true,
            case_id: true,
            emergency_contacts: true,
            document_url: true,
            delivered_at: true,
            delivered_to: true,
            created_at: true,
            updated_at: true,
          },
        }),
  ]);
  const homeCareFeatureSummary = await getPatientHomeCareFeatureSummary(prisma, {
    orgId: ctx.orgId,
    patientId: id,
  });

  const actorNameMap = await batchResolveNames(
    prisma,
    ctx.orgId,
    Array.from(
      new Set(
        compactTimelineValues([
          ...visitSchedules.map((item) => item.pharmacist_id),
          ...visitRecords.map((item) => item.pharmacist_id),
          ...careReports.map((item) => item.created_by),
          ...dispenseResults.map((item) => item.dispensed_by),
          ...managementPlans.flatMap((item) => [
            item.created_by,
            item.approved_by,
            item.reviewed_by,
          ]),
        ]),
      ),
    ),
  );

  // Lab summary: most recent value per analyte for key analytes
  const labRows = await prisma.patientLabObservation.findMany({
    where: {
      org_id: ctx.orgId,
      patient_id: id,
      analyte_code: { in: [...KEY_LAB_ANALYTE_CODES] },
    },
    orderBy: [{ measured_at: 'desc' }],
    take: 50,
    select: {
      id: true,
      analyte_code: true,
      measured_at: true,
      value_numeric: true,
      value_text: true,
      unit: true,
      abnormal_flag: true,
    },
  });

  // Latest per analyte
  const labSummaryMap = new Map<string, (typeof labRows)[number]>();
  for (const row of labRows) {
    if (!labSummaryMap.has(row.analyte_code)) {
      labSummaryMap.set(row.analyte_code, row);
    }
  }
  const labSummary = Array.from(labSummaryMap.values());
  const privacy = getPatientPrivacyFlags(ctx.role);

  const timeline_events = [
    ...visitSchedules.map((item) => ({
      id: `visit_schedule:${item.id}`,
      event_type: 'visit_schedule' as const,
      category: 'visit' as const,
      occurred_at: item.confirmed_at ?? item.updated_at ?? item.created_at,
      title: item.confirmed_at ? '訪問予定を確定' : '訪問予定を登録',
      summary:
        compactTimelineValues([
          VISIT_TYPE_LABELS[item.visit_type] ?? item.visit_type,
          formatTimelineDate(item.scheduled_date)
            ? `訪問日 ${formatTimelineDate(item.scheduled_date)}`
            : null,
          item.visit_record ? '訪問記録あり' : null,
        ]).join(' / ') || null,
      href: item.visit_record ? `/visits/${item.visit_record.id}` : `/visits/${item.id}/record`,
      action_label: item.visit_record ? '訪問記録を開く' : '訪問記録を入力',
      status: item.schedule_status,
      status_label: SCHEDULE_STATUS_LABELS[item.schedule_status] ?? item.schedule_status,
      actor_name: actorNameMap.get(item.pharmacist_id) ?? null,
      metadata: compactTimelineValues([
        item.priority ? `優先度 ${PRIORITY_LABELS[item.priority] ?? item.priority}` : null,
        item.route_order ? `ルート順 ${item.route_order}` : null,
      ]),
    })),
    ...visitRecords.map((item) => ({
      id: `visit_record:${item.id}`,
      event_type: 'visit_record' as const,
      category: 'visit' as const,
      occurred_at: item.visit_date ?? item.created_at,
      title: '訪問記録を登録',
      summary:
        compactTimelineValues([
          item.revisit_reason,
          item.postpone_reason,
          item.cancellation_reason,
        ]).join(' / ') || null,
      href: `/visits/${item.id}`,
      action_label: '訪問記録を開く',
      status: item.outcome_status,
      status_label: VISIT_OUTCOME_LABELS[item.outcome_status] ?? item.outcome_status,
      actor_name: actorNameMap.get(item.pharmacist_id) ?? null,
      metadata: compactTimelineValues([
        item.next_visit_suggestion_date
          ? `次回提案 ${formatTimelineDate(item.next_visit_suggestion_date)}`
          : null,
      ]),
    })),
    ...prescriptionIntakes.map((item) => ({
      id: `prescription_intake:${item.id}`,
      event_type: 'prescription_intake' as const,
      category: 'prescription' as const,
      occurred_at: item.created_at,
      title: '処方受付を登録',
      summary:
        compactTimelineValues([
          PRESCRIPTION_SOURCE_LABELS[item.source_type] ?? item.source_type,
          item.prescriber_name ?? item.prescriber_institution,
          formatTimelineDate(item.prescribed_date)
            ? `処方日 ${formatTimelineDate(item.prescribed_date)}`
            : null,
        ]).join(' / ') || null,
      href: `/prescriptions/${item.id}`,
      action_label: '処方受付を開く',
      status: item.cycle.overall_status,
      status_label: CYCLE_STATUS_LABELS[item.cycle.overall_status] ?? item.cycle.overall_status,
      actor_name: item.original_collected_by ?? null,
      metadata: compactTimelineValues([
        item.lines.length > 0 ? `${item.lines.length}剤まで表示` : null,
      ]),
    })),
    ...dispenseResults.map((item) => ({
      id: `dispense_result:${item.id}`,
      event_type: 'dispense_result' as const,
      category: 'prescription' as const,
      occurred_at: item.dispensed_at,
      title: '調剤を記録',
      summary:
        compactTimelineValues([
          item.actual_drug_name,
          `${item.actual_quantity}${item.actual_unit ?? ''}`,
          CARRY_TYPE_LABELS[item.carry_type] ?? item.carry_type,
        ]).join(' / ') || null,
      href: `/prescriptions/${item.line.intake.id}`,
      action_label: '調剤詳細を開く',
      status: item.task.cycle?.overall_status ?? 'dispensed',
      status_label: CYCLE_STATUS_LABELS[item.task.cycle?.overall_status ?? 'dispensed'] ?? '調剤済',
      actor_name: actorNameMap.get(item.dispensed_by) ?? null,
      metadata: [],
    })),
    ...inquiryRecords.map((item) => {
      const inquiryStatus =
        item.result === 'changed'
          ? '変更あり'
          : item.result === 'unchanged'
            ? '変更なし'
            : '回答待ち';
      const detail = item.change_detail ?? item.inquiry_content ?? null;
      const metadata = compactTimelineValues([
        item.inquired_at ? `照会 ${formatTimelineDate(item.inquired_at)}` : null,
        item.proposal_origin === 'pre_issuance' ? '事前提案反映' : '照会後変更',
        item.residual_adjustment ? '残薬調整' : null,
      ]);

      return {
        id: `inquiry:${item.id}`,
        event_type: 'inquiry' as const,
        category: 'prescription' as const,
        occurred_at: item.resolved_at ?? item.inquired_at ?? item.created_at,
        title: `疑義照会 ${inquiryStatus}`,
        summary:
          compactTimelineValues([item.reason, item.inquiry_to_physician, detail]).join(' / ') ||
          null,
        href: item.line?.intake?.id ? `/prescriptions/${item.line.intake.id}` : '/workflow',
        action_label: item.line?.intake?.id ? '処方受付を開く' : 'ワークフローを開く',
        status: item.result ?? 'pending',
        status_label: inquiryStatus,
        actor_name: null,
        metadata,
      };
    }),
    ...careReports.flatMap((item) => [
      {
        id: `care_report:${item.id}`,
        event_type: 'care_report' as const,
        category: 'document' as const,
        occurred_at: item.created_at,
        title: '報告書を作成',
        summary:
          compactTimelineValues([
            REPORT_TYPE_LABELS[item.report_type] ?? item.report_type,
            REPORT_STATUS_CONFIG[item.status]?.label ?? item.status,
          ]).join(' / ') || null,
        href: `/reports/${item.id}`,
        action_label: '報告書を開く',
        status: item.status,
        status_label: REPORT_STATUS_CONFIG[item.status]?.label ?? item.status,
        actor_name: actorNameMap.get(item.created_by) ?? null,
        metadata: [],
      },
      ...item.delivery_records.map((delivery) => ({
        id: `delivery_record:${delivery.id}`,
        event_type: 'delivery_record' as const,
        category: 'document' as const,
        occurred_at: delivery.confirmed_at ?? delivery.sent_at ?? delivery.created_at,
        title: delivery.status === 'confirmed' ? '報告書の受領を確認' : '報告書を送付',
        summary:
          compactTimelineValues([
            delivery.recipient_name,
            CHANNEL_LABELS[delivery.channel] ?? delivery.channel,
            REPORT_TYPE_LABELS[item.report_type] ?? item.report_type,
          ]).join(' / ') || null,
        href: `/reports/${item.id}`,
        action_label: '送付元報告書を開く',
        status: delivery.status,
        status_label: REPORT_STATUS_CONFIG[delivery.status]?.label ?? delivery.status,
        actor_name: actorNameMap.get(item.created_by) ?? null,
        metadata: [],
      })),
    ]),
    ...managementPlans.map((item) => {
      const actorId = item.approved_by ?? item.reviewed_by ?? item.created_by;
      const occurredAt = item.approved_at ?? item.reviewed_at ?? item.created_at;

      return {
        id: `management_plan:${item.id}`,
        event_type: 'management_plan' as const,
        category: 'document' as const,
        occurred_at: occurredAt,
        title: item.approved_at ? '管理計画書を承認' : '管理計画書を作成',
        summary:
          compactTimelineValues([
            item.title,
            item.effective_from ? `適用開始 ${formatTimelineDate(item.effective_from)}` : null,
            item.next_review_date
              ? `次回見直し ${formatTimelineDate(item.next_review_date)}`
              : null,
          ]).join(' / ') || null,
        href: `/patients/${id}/management-plan`,
        action_label: '計画書を開く',
        status: item.status,
        status_label: MANAGEMENT_PLAN_STATUS_LABELS[item.status] ?? item.status,
        actor_name: actorNameMap.get(actorId) ?? null,
        metadata: [],
      };
    }),
    ...firstVisitDocuments.map((item) => {
      const isDelivered = Boolean(item.delivered_at);
      return {
        id: `first_visit_document:${item.id}`,
        event_type: 'first_visit_document' as const,
        category: 'document' as const,
        occurred_at: item.delivered_at ?? item.created_at,
        title: isDelivered ? '初回訪問文書を交付' : '初回訪問文書を作成',
        summary:
          compactTimelineValues([
            item.delivered_to,
            isDelivered ? '交付記録あり' : '交付未記録',
          ]).join(' / ') || null,
        href: item.document_url ?? `/patients/${id}`,
        action_label: item.document_url ? 'PDFを見る' : '患者詳細を開く',
        status: isDelivered ? 'delivered' : 'created',
        status_label: isDelivered ? '交付済み' : '作成済み',
        actor_name: null,
        metadata: [],
      };
    }),
    ...selfReports.map((item) => ({
      id: `self_report:${item.id}`,
      event_type: 'self_report' as const,
      category: 'communication' as const,
      occurred_at: item.created_at,
      title: '患者から自己申告を受信',
      summary:
        compactTimelineValues([
          item.subject,
          item.category,
          previewTimelineText(item.content),
        ]).join(' / ') || null,
      href: `/patients/${id}/collaboration`,
      action_label: '連携を確認',
      status: item.status,
      status_label: SELF_REPORT_STATUS_LABELS[item.status] ?? item.status,
      actor_name: item.reported_by_name,
      metadata: compactTimelineValues([
        item.relation ? `関係 ${item.relation}` : null,
        item.requested_callback ? '折返し希望' : null,
        item.preferred_contact_time ? `希望時間 ${item.preferred_contact_time}` : null,
      ]),
    })),
    ...communicationEvents
      .filter((item) => item.event_type !== 'patient_self_report')
      .map((item) => {
        const directionLabel = getCommunicationDirectionLabel(item.direction);

        return {
          id: `communication:${item.id}`,
          event_type: 'communication' as const,
          category: 'communication' as const,
          occurred_at: item.occurred_at,
          title: directionLabel === '受信' ? '連絡を受信' : '連絡を発信',
          summary:
            compactTimelineValues([
              CHANNEL_LABELS[item.channel] ?? item.channel,
              item.counterpart_name,
              item.subject ?? item.event_type,
            ]).join(' / ') || null,
          href: `/conferences?patient_id=${id}`,
          action_label: '連絡履歴を開く',
          status: item.direction,
          status_label: directionLabel,
          actor_name: null,
          metadata: [],
        };
      }),
    ...externalShares.map((item) => ({
      id: `external_share:${item.id}`,
      event_type: 'external_share' as const,
      category: 'communication' as const,
      occurred_at: item.created_at,
      title: '外部共有リンクを発行',
      summary:
        compactTimelineValues([
          item.granted_to_name,
          item.accessed_at ? '閲覧済み' : '未閲覧',
        ]).join(' / ') || null,
      href: `/patients/${id}/share`,
      action_label: '共有設定を開く',
      status: item.accessed_at ? 'accessed' : 'issued',
      status_label: item.accessed_at ? '閲覧済み' : '共有中',
      actor_name: null,
      metadata: compactTimelineValues([`期限 ${formatTimelineDate(item.expires_at)}`]),
    })),
  ]
    .sort((left, right) => right.occurred_at.getTime() - left.occurred_at.getTime())
    .slice(0, 40);

  return success({
    ...patient,
    phone: privacy.sensitiveFieldsMasked ? maskPhoneNumber(patient.phone) : patient.phone,
    medical_insurance_number: privacy.sensitiveFieldsMasked
      ? maskInsuranceNumber(patient.medical_insurance_number)
      : patient.medical_insurance_number,
    care_insurance_number: privacy.sensitiveFieldsMasked
      ? maskInsuranceNumber(patient.care_insurance_number)
      : patient.care_insurance_number,
    residences: (patient.residences ?? []).map((residence) => ({
      ...residence,
      address: privacy.addressFieldsMasked
        ? maskAddressDetail(residence.address)
        : residence.address,
    })),
    contacts: (patient.contacts ?? []).map((contact) => ({
      ...contact,
      phone: privacy.sensitiveFieldsMasked ? maskPhoneNumber(contact.phone) : contact.phone,
      fax: privacy.sensitiveFieldsMasked ? maskPhoneNumber(contact.fax) : contact.fax,
      email: privacy.sensitiveFieldsMasked ? maskContactValue(contact.email) : contact.email,
      address: privacy.addressFieldsMasked ? maskAddressDetail(contact.address) : contact.address,
    })),
    current_medications: currentMedications,
    visit_schedules: visitSchedules,
    monthly_visit_count: currentMonthVisitCount,
    visit_records: visitRecords,
    care_reports: careReports,
    self_reports: selfReports,
    external_shares: externalShares.map((item) => ({
      ...item,
      scope: toPublicExternalAccessScope(item.scope),
      granted_to_contact: privacy.sensitiveFieldsMasked
        ? maskContactValue(item.granted_to_contact)
        : item.granted_to_contact,
    })),
    open_tasks: openTasks,
    medication_issues: medicationIssues,
    communication_queue: communicationQueue,
    risk_summary: riskSummary,
    home_care_feature_summary: homeCareFeatureSummary,
    visit_brief: visitBrief,
    first_visit_documents: firstVisitDocuments.map((item) => ({
      ...item,
      emergency_contacts: normalizeFirstVisitDocumentContacts(item.emergency_contacts).map(
        (contact) => ({
          ...contact,
          phone: privacy.sensitiveFieldsMasked ? maskPhoneNumber(contact.phone) : contact.phone,
          fax: privacy.sensitiveFieldsMasked ? maskPhoneNumber(contact.fax) : contact.fax,
          email: privacy.sensitiveFieldsMasked ? maskContactValue(contact.email) : contact.email,
        }),
      ),
    })),
    billing_summary: {
      evidence: billingEvidence.map((item) => ({
        ...item,
        blockers: billingEvidenceBlockers.find((blocker) => blocker.id === item.id)?.blockers ?? [],
      })),
      candidates: billingCandidates,
      claimable_count: billingEvidence.filter((item) => item.claimable).length,
      blocked_count: billingEvidence.filter((item) => !item.claimable).length,
    },
    lab_summary: labSummary,
    timeline_events,
    privacy: {
      sensitive_fields_masked: privacy.sensitiveFieldsMasked,
      address_fields_masked: privacy.addressFieldsMasked,
      can_view_detail: privacy.canViewDetail,
    },
  });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '患者情報の更新権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;

  const { id: rawId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return validationError('患者IDが不正です');

  const payload = await readJsonObjectRequestBody(req);
  if (!payload) return validationError('リクエストボディが不正です');

  const parsed = updatePatientSchema.safeParse(payload);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const existing = await prisma.patient.findFirst({
    where: buildPatientDetailWhere({
      orgId: ctx.orgId,
      patientId: id,
      role: ctx.role,
      userId: ctx.userId,
    }),
  });
  if (!existing) return notFound('患者が見つかりません');

  const {
    address,
    birth_date,
    building_id,
    facility_id,
    facility_unit_id,
    unit_name,
    contacts,
    conditions,
    requester,
    intake,
    medical_insurance_number,
    care_insurance_number,
    ...rest
  } = parsed.data;

  try {
    const patient = await withOrgContext(
      ctx.orgId,
      async (tx) => {
        const primaryResidence = await tx.residence.findFirst({
          where: { patient_id: id, is_primary: true },
          select: {
            id: true,
            facility_id: true,
            facility_unit_id: true,
          },
        });

        const currentFacilityId = primaryResidence?.facility_id ?? null;
        const nextFacilityId = facility_id !== undefined ? facility_id || null : currentFacilityId;
        const nextFacilityUnitId =
          facility_unit_id !== undefined
            ? facility_unit_id || null
            : facility_id !== undefined && nextFacilityId !== currentFacilityId
              ? null
              : (primaryResidence?.facility_unit_id ?? null);

        const facilityVisitDefaults =
          facility_id !== undefined
            ? await getFacilityVisitDefaults(tx, ctx.orgId, nextFacilityId)
            : null;

        if (facility_id !== undefined) {
          await assertFacilityReference(tx, ctx.orgId, nextFacilityId);
        }
        if (facility_id !== undefined || facility_unit_id !== undefined) {
          await assertFacilityUnitReference(tx, ctx.orgId, nextFacilityId, nextFacilityUnitId);
        }

        const normalizedMedicalInsuranceNumber =
          medical_insurance_number !== undefined
            ? (normalizeNullableText(medical_insurance_number) ?? null)
            : undefined;
        const normalizedCareInsuranceNumber =
          care_insurance_number !== undefined
            ? (normalizeNullableText(care_insurance_number) ?? null)
            : undefined;

        const updated = await tx.patient.update({
          where: { id },
          data: {
            ...(birth_date ? { birth_date: new Date(birth_date) } : {}),
            ...(normalizedMedicalInsuranceNumber !== undefined
              ? { medical_insurance_number: normalizedMedicalInsuranceNumber }
              : {}),
            ...(normalizedCareInsuranceNumber !== undefined
              ? { care_insurance_number: normalizedCareInsuranceNumber }
              : {}),
            ...rest,
          } as Prisma.PatientUpdateInput,
        });

        if (
          address !== undefined ||
          building_id !== undefined ||
          facility_id !== undefined ||
          facility_unit_id !== undefined ||
          unit_name !== undefined
        ) {
          if (primaryResidence) {
            await tx.residence.update({
              where: { id: primaryResidence.id },
              data: {
                ...(address !== undefined ? { address } : {}),
                ...(building_id !== undefined ? { building_id: building_id || null } : {}),
                ...(facility_id !== undefined ? { facility_id: nextFacilityId } : {}),
                ...(facility_unit_id !== undefined ||
                (facility_id !== undefined && nextFacilityId !== currentFacilityId)
                  ? { facility_unit_id: nextFacilityUnitId }
                  : {}),
                ...(unit_name !== undefined ? { unit_name: unit_name || null } : {}),
              },
            });
          } else {
            await tx.residence.create({
              data: {
                org_id: ctx.orgId,
                patient_id: id,
                address: address ?? '',
                building_id: building_id || null,
                facility_id: nextFacilityId,
                facility_unit_id: nextFacilityUnitId,
                unit_name: unit_name || null,
                is_primary: true,
              },
            });
          }
        }

        if (contacts) {
          await tx.contactParty.deleteMany({
            where: { org_id: ctx.orgId, patient_id: id },
          });
          if (contacts.length > 0) {
            await tx.contactParty.createMany({
              data: contacts.map((contact) => ({
                org_id: ctx.orgId,
                patient_id: id,
                name: contact.name,
                relation: contact.relation,
                phone: contact.phone || null,
                email: contact.email || null,
                fax: contact.fax || null,
                organization_name: contact.organization_name || null,
                department: contact.department || null,
                address: contact.address || null,
                is_primary: contact.is_primary,
                is_emergency_contact: contact.is_emergency_contact,
                notes: contact.notes || null,
              })),
            });
          }
        }

        if (conditions) {
          await tx.patientCondition.deleteMany({
            where: { org_id: ctx.orgId, patient_id: id },
          });
          if (conditions.length > 0) {
            await tx.patientCondition.createMany({
              data: conditions.map((condition) => ({
                org_id: ctx.orgId,
                patient_id: id,
                condition_type: condition.condition_type,
                name: condition.name,
                is_primary: condition.is_primary,
                is_active: condition.is_active,
                noted_at: condition.noted_at ? new Date(condition.noted_at) : null,
                notes: condition.notes || null,
              })),
            });
          }
        }

        const schedulePreferenceCreateData: Prisma.PatientSchedulePreferenceUncheckedCreateInput = {
          org_id: ctx.orgId,
          patient_id: id,
        };
        const schedulePreferencePatchData: Prisma.PatientSchedulePreferenceUncheckedUpdateInput =
          {};

        if (facility_id !== undefined) {
          const facilityTimeFrom = facilityVisitDefaults?.acceptance_time_from ?? null;
          const facilityTimeTo = facilityVisitDefaults?.acceptance_time_to ?? null;
          schedulePreferenceCreateData.facility_time_from = facilityTimeFrom;
          schedulePreferenceCreateData.facility_time_to = facilityTimeTo;
          schedulePreferencePatchData.facility_time_from = facilityTimeFrom;
          schedulePreferencePatchData.facility_time_to = facilityTimeTo;
        }

        const preferredContactPhoneCandidate =
          (intake && hasOwnKey(intake, 'contact_phone') ? intake.contact_phone : undefined) ??
          updated.phone ??
          (intake && hasOwnKey(intake, 'contact_mobile') ? intake.contact_mobile : undefined) ??
          existing.phone;
        const nextPreferredContactPhone =
          normalizeNullableText(preferredContactPhoneCandidate) ?? null;

        if (requester || intake) {
          if (requester && hasOwnKey(requester, 'contact_name')) {
            const preferredContactName = normalizeNullableText(requester.contact_name) ?? null;
            schedulePreferenceCreateData.preferred_contact_name = preferredContactName;
            schedulePreferencePatchData.preferred_contact_name = preferredContactName;
          } else if (intake && hasOwnKey(intake, 'emergency_contact')) {
            const preferredContactName =
              normalizeNullableText(intake.emergency_contact?.name) ?? null;
            schedulePreferenceCreateData.preferred_contact_name = preferredContactName;
            schedulePreferencePatchData.preferred_contact_name = preferredContactName;
          }

          schedulePreferenceCreateData.preferred_contact_phone = nextPreferredContactPhone;
          schedulePreferencePatchData.preferred_contact_phone = nextPreferredContactPhone;

          if (intake) {
            if (hasOwnKey(intake, 'primary_contact_preference')) {
              const value = normalizeNullableText(intake.primary_contact_preference) ?? null;
              schedulePreferenceCreateData.primary_contact_preference = value;
              schedulePreferencePatchData.primary_contact_preference = value;
            }
            if (hasOwnKey(intake, 'visit_before_contact_required')) {
              const value = intake.visit_before_contact_required ?? null;
              schedulePreferenceCreateData.visit_before_contact_required = value;
              schedulePreferencePatchData.visit_before_contact_required = value;
            }
            if (hasOwnKey(intake, 'first_visit_preferred_date')) {
              const value = intake.first_visit_preferred_date
                ? new Date(intake.first_visit_preferred_date)
                : null;
              schedulePreferenceCreateData.first_visit_preferred_date = value;
              schedulePreferencePatchData.first_visit_preferred_date = value;
            }
            if (hasOwnKey(intake, 'first_visit_time_slot')) {
              const value = normalizeNullableText(intake.first_visit_time_slot) ?? null;
              schedulePreferenceCreateData.first_visit_time_slot = value;
              schedulePreferencePatchData.first_visit_time_slot = value;
            }
            if (hasOwnKey(intake, 'first_visit_time_note')) {
              const value = normalizeNullableText(intake.first_visit_time_note) ?? null;
              schedulePreferenceCreateData.first_visit_time_note = value;
              schedulePreferencePatchData.first_visit_time_note = value;
            }
            if (hasOwnKey(intake, 'parking_available')) {
              const value = intake.parking_available ?? null;
              schedulePreferenceCreateData.parking_available = value;
              schedulePreferencePatchData.parking_available = value;
            }
            if (hasOwnKey(intake, 'mcs_linked')) {
              const value = intake.mcs_linked ?? null;
              schedulePreferenceCreateData.mcs_linked = value;
              schedulePreferencePatchData.mcs_linked = value;
            }
            if (hasOwnKey(intake, 'adl_level')) {
              const value = normalizeNullableText(intake.adl_level) ?? null;
              schedulePreferenceCreateData.adl_level = value;
              schedulePreferencePatchData.adl_level = value;
            }
            if (hasOwnKey(intake, 'dementia_level')) {
              const value = normalizeNullableText(intake.dementia_level) ?? null;
              schedulePreferenceCreateData.dementia_level = value;
              schedulePreferencePatchData.dementia_level = value;
            }
            if (hasOwnKey(intake, 'swallowing_route')) {
              const value = normalizeNullableText(intake.swallowing_route) ?? null;
              schedulePreferenceCreateData.swallowing_route = value;
              schedulePreferencePatchData.swallowing_route = value;
            }
            if (hasOwnKey(intake, 'care_level')) {
              const value = normalizeNullableText(intake.care_level) ?? null;
              schedulePreferenceCreateData.care_level = value;
              schedulePreferencePatchData.care_level = value;
            }
            if (hasOwnKey(intake, 'infection_isolation')) {
              const rawIsolation = normalizeNullableText(intake.infection_isolation);
              if (rawIsolation !== undefined) {
                const trueValues = [
                  '要',
                  'あり',
                  'true',
                  '1',
                  'yes',
                  'droplet',
                  'contact',
                  'airborne',
                ];
                const falseValues = ['不要', 'なし', 'false', '0', 'no', 'none'];
                const lower = rawIsolation.toLowerCase();
                const isolationValue = trueValues.some((v) => v === rawIsolation || v === lower)
                  ? true
                  : falseValues.some((v) => v === rawIsolation || v === lower)
                    ? false
                    : rawIsolation.length > 0; // non-empty unknown strings default to true
                schedulePreferenceCreateData.infection_isolation = isolationValue;
                schedulePreferencePatchData.infection_isolation = isolationValue;
              }
            }
          }
        }

        if (Object.keys(schedulePreferencePatchData).length > 0) {
          await tx.patientSchedulePreference.upsert({
            where: {
              patient_id: id,
            },
            create: schedulePreferenceCreateData,
            update: schedulePreferencePatchData,
          });
        }

        if (requester || intake) {
          const assignedCareCaseWhere = buildAssignedCareCaseWhere(ctx);
          const activeCaseBaseWhere: Prisma.CareCaseWhereInput = {
            org_id: ctx.orgId,
            patient_id: id,
            ...(assignedCareCaseWhere ? { AND: [assignedCareCaseWhere] } : {}),
          };
          const activeCase =
            (await tx.careCase.findFirst({
              where: {
                ...activeCaseBaseWhere,
                status: { in: [...OPEN_CASE_STATUSES] },
              },
              orderBy: [{ updated_at: 'desc' }],
              select: {
                id: true,
                required_visit_support: true,
              },
            })) ??
            (await tx.careCase.findFirst({
              where: activeCaseBaseWhere,
              orderBy: [{ updated_at: 'desc' }],
              select: {
                id: true,
                required_visit_support: true,
              },
            }));

          if (activeCase) {
            const nextHomeVisitIntake = mergeHomeVisitIntake({
              current: getHomeVisitIntake(activeCase.required_visit_support),
              requester,
              intake,
            });
            const currentRequiredVisitSupport = readJsonObject(activeCase.required_visit_support);
            const nextRequiredVisitSupport = currentRequiredVisitSupport
              ? { ...currentRequiredVisitSupport }
              : {};

            if (nextHomeVisitIntake) {
              nextRequiredVisitSupport.home_visit_intake = nextHomeVisitIntake;
            } else {
              delete nextRequiredVisitSupport.home_visit_intake;
            }

            await tx.careCase.update({
              where: { id: activeCase.id },
              data: {
                ...(requester && hasOwnKey(requester, 'organization_name')
                  ? {
                      referral_source: normalizeNullableText(requester.organization_name) ?? null,
                    }
                  : {}),
                required_visit_support: normalizeInputJsonObject(nextRequiredVisitSupport),
              },
            });
          }
        }

        for (const [insuranceType, nextNumber] of [
          ['medical', normalizedMedicalInsuranceNumber],
          ['care', normalizedCareInsuranceNumber],
        ] as const) {
          if (nextNumber === undefined) continue;

          if (nextNumber) {
            const currentInsurance = await tx.patientInsurance.findFirst({
              where: {
                org_id: ctx.orgId,
                patient_id: id,
                insurance_type: insuranceType,
                is_active: true,
              },
              orderBy: [{ valid_from: 'desc' }, { created_at: 'desc' }],
              select: { id: true, number: true },
            });

            const numberChanged = currentInsurance ? currentInsurance.number !== nextNumber : true;

            if (numberChanged) {
              // valid_from / valid_until(@db.Date)へはローカル日付の UTC 深夜で書き込む
              // (ローカル深夜だと JST では前日の日付として保存される)
              const today = utcDateFromLocalKey(localDateKey());

              // Close ALL active rows for this insurance type (Fix #3: multi-active guard)
              await tx.patientInsurance.updateMany({
                where: {
                  org_id: ctx.orgId,
                  patient_id: id,
                  insurance_type: insuranceType,
                  is_active: true,
                },
                data: {
                  is_active: false,
                  valid_until: today,
                },
              });

              // Create new active row
              await tx.patientInsurance.create({
                data: {
                  org_id: ctx.orgId,
                  patient_id: id,
                  insurance_type: insuranceType,
                  number: nextNumber,
                  valid_from: today,
                  is_active: true,
                },
              });
            }
          } else {
            await tx.patientInsurance.updateMany({
              where: {
                org_id: ctx.orgId,
                patient_id: id,
                insurance_type: insuranceType,
                is_active: true,
              },
              data: {
                is_active: false,
              },
            });
          }
        }

        return updated;
      },
      { requestContext: ctx },
    );

    return success(patient);
  } catch (error) {
    if (
      error instanceof FacilityReferenceValidationError ||
      error instanceof FacilityUnitReferenceValidationError
    ) {
      return validationError(error.message);
    }
    throw error;
  }
}
