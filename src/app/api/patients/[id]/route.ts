import { format } from 'date-fns';
import { NextRequest } from 'next/server';
import { unstable_rethrow } from 'next/navigation';
import { requireAuthContext } from '@/lib/auth/context';
import { hasPermission } from '@/lib/auth/permissions';
import { withOrgContext } from '@/lib/db/rls';
import { normalizeJsonInput, readJsonObject } from '@/lib/db/json';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { conflict, internalError, success, validationError, notFound } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { validateOrgReferences } from '@/lib/api/org-reference';
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
import {
  writePatientFieldRevisions,
  sortJsonArrayStable,
  isJsonEqual,
  type PatientFieldRevisionEntry,
} from '@/server/services/patient-field-revision';
import { upsertOperationalTask } from '@/server/services/operational-tasks';
import { syncStructuredHomeCare } from '@/server/services/patient-structured-care';
import { batchResolveNames } from '@/lib/utils/name-resolver';
import { localDateKey, utcDateFromLocalKey } from '@/lib/utils/date-boundary';
import { getHomeVisitIntake, type HomeVisitIntake } from '@/lib/patient/home-visit-intake';
import { normalizePatientPrimaryContacts } from '@/lib/patient/care-team-contact';
import {
  findPatientDuplicateCandidates,
  parsePatientDuplicateBirthDate,
} from '@/lib/patient/duplicate-detection';
import { KEY_LAB_ANALYTE_CODES } from '@/lib/patient/lab-analytes';
import {
  buildAssignedCareCaseWhere,
  buildCareReportCaseScope,
  buildNullableCaseScope,
  buildPatientDetailWhere,
  buildVisitRecordCaseScope,
} from '@/server/services/patient-detail-scope';
import {
  buildVisibleExternalAccessGrantWhere,
  toPublicExternalAccessScope,
} from '@/server/services/external-access';
import { buildPatientTimelineEvents } from '@/server/services/patient-detail-timeline-events';
import { recordPhiReadAuditForRequest } from '@/lib/audit/phi-read-audit';
import { listPatientBillingCaseRefs } from '@/server/services/patient-detail-billing-refs';
import {
  buildPatientTimelineConferenceNoteWhere,
  buildPatientTimelineOperationHistoryFilters,
} from '@/server/services/patient-detail-timeline-query';

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

const OPEN_CASE_STATUSES = ['referral_received', 'assessment', 'active', 'on_hold'] as const;

type PatientRequesterPatch = NonNullable<UpdatePatientData['requester']>;
type PatientIntakePatch = NonNullable<UpdatePatientData['intake']>;
const PATIENT_EXTERNAL_SHARE_LIMIT = 8;

function normalizeExpectedUpdatedAt(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeCurrentUpdatedAt(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function listVisibleExternalSharesForPatient(args: {
  orgId: string;
  patientId: string;
  caseIds: string[];
}) {
  return prisma.externalAccessGrant.findMany({
    where: buildVisibleExternalAccessGrantWhere(args),
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
      'home_care_status',
      args.intake.home_care_status,
      hasOwnKey(args.intake, 'home_care_status'),
    );
    assignTextField(
      next,
      'home_start_date',
      args.intake.home_start_date,
      hasOwnKey(args.intake, 'home_start_date'),
    );
    assignTextField(
      next,
      'home_end_date',
      args.intake.home_end_date,
      hasOwnKey(args.intake, 'home_end_date'),
    );
    assignTextField(
      next,
      'home_end_reason',
      args.intake.home_end_reason,
      hasOwnKey(args.intake, 'home_end_reason'),
    );
    assignTextField(
      next,
      'emergency_response',
      args.intake.emergency_response,
      hasOwnKey(args.intake, 'emergency_response'),
    );
    assignTextField(
      next,
      'after_hours_explanation_date',
      args.intake.after_hours_explanation_date,
      hasOwnKey(args.intake, 'after_hours_explanation_date'),
    );
    assignArrayField(
      next,
      'patient_tags',
      args.intake.patient_tags,
      hasOwnKey(args.intake, 'patient_tags'),
    );
    assignTextField(
      next,
      'visit_frequency',
      args.intake.visit_frequency,
      hasOwnKey(args.intake, 'visit_frequency'),
    );
    assignTextField(
      next,
      'regular_visit_slot',
      args.intake.regular_visit_slot,
      hasOwnKey(args.intake, 'regular_visit_slot'),
    );
    assignTextField(
      next,
      'visit_available_time_note',
      args.intake.visit_available_time_note,
      hasOwnKey(args.intake, 'visit_available_time_note'),
    );
    assignTextField(
      next,
      'access_key_info',
      args.intake.access_key_info,
      hasOwnKey(args.intake, 'access_key_info'),
    );
    assignTextField(
      next,
      'medication_handover_place',
      args.intake.medication_handover_place,
      hasOwnKey(args.intake, 'medication_handover_place'),
    );
    assignTextField(
      next,
      'medication_storage_location',
      args.intake.medication_storage_location,
      hasOwnKey(args.intake, 'medication_storage_location'),
    );
    assignTextField(
      next,
      'collection_method',
      args.intake.collection_method,
      hasOwnKey(args.intake, 'collection_method'),
    );
    assignTextField(next, 'payer', args.intake.payer, hasOwnKey(args.intake, 'payer'));
    assignTextField(
      next,
      'medication_manager',
      args.intake.medication_manager,
      hasOwnKey(args.intake, 'medication_manager'),
    );
    assignTextField(
      next,
      'medication_ability',
      args.intake.medication_ability,
      hasOwnKey(args.intake, 'medication_ability'),
    );
    assignTextField(
      next,
      'missed_dose_pattern',
      args.intake.missed_dose_pattern,
      hasOwnKey(args.intake, 'missed_dose_pattern'),
    );
    assignTextField(
      next,
      'residual_medication_pattern',
      args.intake.residual_medication_pattern,
      hasOwnKey(args.intake, 'residual_medication_pattern'),
    );
    assignTextField(
      next,
      'residual_medication_checked_on',
      args.intake.residual_medication_checked_on,
      hasOwnKey(args.intake, 'residual_medication_checked_on'),
    );
    assignTextField(
      next,
      'residual_adjustment_status',
      args.intake.residual_adjustment_status,
      hasOwnKey(args.intake, 'residual_adjustment_status'),
    );
    assignTextField(
      next,
      'crushing_check_status',
      args.intake.crushing_check_status,
      hasOwnKey(args.intake, 'crushing_check_status'),
    );
    assignTextField(
      next,
      'simple_suspension_check_status',
      args.intake.simple_suspension_check_status,
      hasOwnKey(args.intake, 'simple_suspension_check_status'),
    );
    assignTextField(
      next,
      'egfr_value',
      args.intake.egfr_value,
      hasOwnKey(args.intake, 'egfr_value'),
    );
    assignTextField(
      next,
      'egfr_measured_on',
      args.intake.egfr_measured_on,
      hasOwnKey(args.intake, 'egfr_measured_on'),
    );
    assignTextField(next, 'weight_kg', args.intake.weight_kg, hasOwnKey(args.intake, 'weight_kg'));
    assignTextField(
      next,
      'weight_measured_on',
      args.intake.weight_measured_on,
      hasOwnKey(args.intake, 'weight_measured_on'),
    );
    assignArrayField(
      next,
      'high_risk_drug_flags',
      args.intake.high_risk_drug_flags,
      hasOwnKey(args.intake, 'high_risk_drug_flags'),
    );
    assignArrayField(
      next,
      'adverse_monitoring_items',
      args.intake.adverse_monitoring_items,
      hasOwnKey(args.intake, 'adverse_monitoring_items'),
    );
    assignTextField(
      next,
      'pain_score',
      args.intake.pain_score,
      hasOwnKey(args.intake, 'pain_score'),
    );
    assignTextField(
      next,
      'rescue_use_count_recent',
      args.intake.rescue_use_count_recent,
      hasOwnKey(args.intake, 'rescue_use_count_recent'),
    );
    assignTextField(
      next,
      'constipation_status',
      args.intake.constipation_status,
      hasOwnKey(args.intake, 'constipation_status'),
    );
    assignTextField(
      next,
      'drowsiness_delirium_status',
      args.intake.drowsiness_delirium_status,
      hasOwnKey(args.intake, 'drowsiness_delirium_status'),
    );
    assignTextField(next, 'fall_risk', args.intake.fall_risk, hasOwnKey(args.intake, 'fall_risk'));
    assignTextField(
      next,
      'pressure_ulcer_status',
      args.intake.pressure_ulcer_status,
      hasOwnKey(args.intake, 'pressure_ulcer_status'),
    );
    assignTextField(
      next,
      'medical_material_supplier',
      args.intake.medical_material_supplier,
      hasOwnKey(args.intake, 'medical_material_supplier'),
    );
    assignTextField(
      next,
      'material_exchange_due_note',
      args.intake.material_exchange_due_note,
      hasOwnKey(args.intake, 'material_exchange_due_note'),
    );
    assignTextField(
      next,
      'device_vendor_contact',
      args.intake.device_vendor_contact,
      hasOwnKey(args.intake, 'device_vendor_contact'),
    );
    assignTextField(
      next,
      'document_status_note',
      args.intake.document_status_note,
      hasOwnKey(args.intake, 'document_status_note'),
    );
    assignTextField(
      next,
      'report_destination_note',
      args.intake.report_destination_note,
      hasOwnKey(args.intake, 'report_destination_note'),
    );
    assignTextField(
      next,
      'emergency_policy_note',
      args.intake.emergency_policy_note,
      hasOwnKey(args.intake, 'emergency_policy_note'),
    );
    assignTextField(
      next,
      'interprofessional_action_note',
      args.intake.interprofessional_action_note,
      hasOwnKey(args.intake, 'interprofessional_action_note'),
    );
    if (hasOwnKey(args.intake, 'home_pharmacy_add_on_2')) {
      const value = args.intake.home_pharmacy_add_on_2;
      if (value) {
        const addOn2 = { ...(next.home_pharmacy_add_on_2 ?? {}) };
        assignTextField(addOn2, 'candidate', value.candidate, hasOwnKey(value, 'candidate'));
        assignTextField(
          addOn2,
          'single_building_medical_patient_count',
          value.single_building_medical_patient_count,
          hasOwnKey(value, 'single_building_medical_patient_count'),
        );
        assignTextField(
          addOn2,
          'single_building_resident_count',
          value.single_building_resident_count,
          hasOwnKey(value, 'single_building_resident_count'),
        );
        assignTextField(
          addOn2,
          'home_care_billing_category',
          value.home_care_billing_category,
          hasOwnKey(value, 'home_care_billing_category'),
        );
        assignTextField(
          addOn2,
          'medical_home_management_type',
          value.medical_home_management_type,
          hasOwnKey(value, 'medical_home_management_type'),
        );
        assignTextField(
          addOn2,
          'medical_home_management_section',
          value.medical_home_management_section,
          hasOwnKey(value, 'medical_home_management_section'),
        );
        assignTextField(
          addOn2,
          'comprehensive_support_add_on',
          value.comprehensive_support_add_on,
          hasOwnKey(value, 'comprehensive_support_add_on'),
        );
        assignTextField(
          addOn2,
          'table_8_2_applicable',
          value.table_8_2_applicable,
          hasOwnKey(value, 'table_8_2_applicable'),
        );
        assignTextField(
          addOn2,
          'table_8_3_applicable',
          value.table_8_3_applicable,
          hasOwnKey(value, 'table_8_3_applicable'),
        );
        assignArrayField(
          addOn2,
          'narcotic_use_categories',
          value.narcotic_use_categories,
          hasOwnKey(value, 'narcotic_use_categories'),
        );
        assignTextField(
          addOn2,
          'aseptic_preparation_need',
          value.aseptic_preparation_need,
          hasOwnKey(value, 'aseptic_preparation_need'),
        );
        assignTextField(
          addOn2,
          'pediatric_home_care',
          value.pediatric_home_care,
          hasOwnKey(value, 'pediatric_home_care'),
        );
        assignTextField(
          addOn2,
          'infant_add_on_candidate',
          value.infant_add_on_candidate,
          hasOwnKey(value, 'infant_add_on_candidate'),
        );
        assignTextField(
          addOn2,
          'medical_care_child',
          value.medical_care_child,
          hasOwnKey(value, 'medical_care_child'),
        );
        assignTextField(
          addOn2,
          'visiting_nurse_frequency',
          value.visiting_nurse_frequency,
          hasOwnKey(value, 'visiting_nurse_frequency'),
        );
        assignTextField(
          addOn2,
          'weekly_visiting_nurse',
          value.weekly_visiting_nurse,
          hasOwnKey(value, 'weekly_visiting_nurse'),
        );
        assignTextField(
          addOn2,
          'nursing_or_family_procedure',
          value.nursing_or_family_procedure,
          hasOwnKey(value, 'nursing_or_family_procedure'),
        );
        assignTextField(
          addOn2,
          'medical_material_supply',
          value.medical_material_supply,
          hasOwnKey(value, 'medical_material_supply'),
        );
        assignTextField(
          addOn2,
          'advanced_medical_device',
          value.advanced_medical_device,
          hasOwnKey(value, 'advanced_medical_device'),
        );
        next.home_pharmacy_add_on_2 = compactNestedObject(addOn2);
      } else {
        delete next.home_pharmacy_add_on_2;
      }
    }
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

async function authenticatedGET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '患者情報の閲覧権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;
  const canManageBilling = hasPermission(ctx.role, 'canManageBilling');

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
  const billingRefs = canManageBilling
    ? await listPatientBillingCaseRefs(prisma, { orgId: ctx.orgId, patientId: id }, caseIds)
    : { visitRecordIds: [] as string[], cycleIds: [] as string[] };
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
    conferenceNotes,
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
    canManageBilling
      ? prisma.billingEvidence.findMany({
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
        })
      : Promise.resolve([]),
    canManageBilling
      ? listBillingEvidenceBlockers(prisma, {
          orgId: ctx.orgId,
          patientId: id,
          visitRecordIds: billingRefs.visitRecordIds,
          cycleIds: billingRefs.cycleIds,
          limit: 6,
        })
      : Promise.resolve([]),
    canManageBilling
      ? prisma.billingCandidate.findMany({
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
            updated_at: true,
          },
        })
      : Promise.resolve([]),
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
      role: ctx.role,
      userId: ctx.userId,
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
    prisma.conferenceNote.findMany({
      where: buildPatientTimelineConferenceNoteWhere({
        orgId: ctx.orgId,
        patientId: id,
        caseIds,
      }),
      orderBy: [{ conference_date: 'desc' }],
      take: 8,
      select: {
        id: true,
        note_type: true,
        title: true,
        conference_date: true,
        follow_up_date: true,
        follow_up_completed: true,
        generated_report_id: true,
        action_items: true,
      },
    }),
  ]);
  const prescriptionIntakeIds = prescriptionIntakes.map((item) => item.id);
  const firstVisitDocumentIds = firstVisitDocuments.map((item) => item.id);
  const billingCandidateIds = billingCandidates.map((item) => item.id);
  const conferenceNoteIds = conferenceNotes.map((item) => item.id);
  const operationHistoryFilters = buildPatientTimelineOperationHistoryFilters({
    patientId: id,
    prescriptionIntakeIds,
    firstVisitDocumentIds,
    billingCandidateIds,
    conferenceNoteIds,
    canManageBilling,
  });

  // homeCareFeatureSummary / operationHistory / labRows は互いに独立した読み取りのため
  // 並列化して RTT を削減(actorNameMap は operationHistory に依存するため後段で逐次実行)。
  const [homeCareFeatureSummary, operationHistory, labRows] = await Promise.all([
    getPatientHomeCareFeatureSummary(prisma, {
      orgId: ctx.orgId,
      patientId: id,
    }),
    prisma.auditLog.findMany({
      where: {
        org_id: ctx.orgId,
        OR: operationHistoryFilters,
      },
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      take: 20,
      select: {
        id: true,
        action: true,
        target_type: true,
        target_id: true,
        actor_id: true,
        changes: true,
        created_at: true,
      },
    }),
    // Lab summary: most recent value per analyte for key analytes
    prisma.patientLabObservation.findMany({
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
    }),
  ]);

  const actorNameMap = await batchResolveNames(
    prisma,
    ctx.orgId,
    Array.from(
      new Set(
        [
          ...visitSchedules.map((item) => item.pharmacist_id),
          ...visitRecords.map((item) => item.pharmacist_id),
          ...careReports.map((item) => item.created_by),
          ...dispenseResults.map((item) => item.dispensed_by),
          ...managementPlans.flatMap((item) => [
            item.created_by,
            item.approved_by,
            item.reviewed_by,
          ]),
          ...operationHistory.map((item) => item.actor_id),
        ].filter((value): value is string => Boolean(value && value.trim())),
      ),
    ),
  );

  // Latest per analyte (labRows は上の Promise.all で並列取得済み)
  const labSummaryMap = new Map<string, (typeof labRows)[number]>();
  for (const row of labRows) {
    if (!labSummaryMap.has(row.analyte_code)) {
      labSummaryMap.set(row.analyte_code, row);
    }
  }
  const labSummary = Array.from(labSummaryMap.values());
  const privacy = getPatientPrivacyFlags(ctx.role);

  // PHI 閲覧監査（3省2GL アクセス記録）。ベストエフォート、await しない。
  recordPhiReadAuditForRequest(ctx, { patientId: id, view: 'patient_detail' });

  const timeline_events = buildPatientTimelineEvents({
    patientId: id,
    actorNameMap,
    visitSchedules,
    visitRecords,
    careReports,
    communicationEvents,
    patientMcsMessages: [],
    partnerVisitRecords: [],
    selfReports,
    externalShares,
    inquiryRecords,
    prescriptionIntakes,
    dispenseResults,
    managementPlans,
    firstVisitDocuments,
    conferenceNotes,
    billingCandidates,
    operationHistory,
  });

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
): Promise<Response> {
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
  const duplicateAcknowledged = payload.duplicate_acknowledged === true;

  const existing = await prisma.patient.findFirst({
    where: buildPatientDetailWhere({
      orgId: ctx.orgId,
      patientId: id,
      role: ctx.role,
      userId: ctx.userId,
    }),
  });
  if (!existing) return notFound('患者が見つかりません');
  if (existing.archived_at) return conflict('アーカイブ中の患者は復元するまで更新できません');

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
    source_visit_record_id,
    expected_updated_at,
    primary_pharmacist_id,
    backup_pharmacist_id,
    primary_staff_id,
    backup_staff_id,
    ...rest
  } = parsed.data;

  const expectedUpdatedAt = normalizeExpectedUpdatedAt(expected_updated_at);
  if (expected_updated_at && expectedUpdatedAt) {
    const currentUpdatedAt = normalizeCurrentUpdatedAt(
      (existing as { updated_at?: unknown }).updated_at,
    );
    if (!currentUpdatedAt || currentUpdatedAt.getTime() !== expectedUpdatedAt.getTime()) {
      return conflict(
        '患者情報が他の操作で更新されています。画面を再読み込みしてから保存してください',
        {
          conflict_type: 'stale_patient',
          expected_updated_at,
          current_updated_at: currentUpdatedAt?.toISOString() ?? null,
        },
      );
    }
  }

  // 担当チーム（患者単位）: 未指定=skip / 空文字=null へ正規化し、ID は org-reference で検証する。
  const normalizeAssignmentId = (value: string | undefined) =>
    value === undefined ? undefined : value === '' ? null : value;
  const normalizedPrimaryPharmacistId = normalizeAssignmentId(primary_pharmacist_id);
  const normalizedBackupPharmacistId = normalizeAssignmentId(backup_pharmacist_id);
  const normalizedPrimaryStaffId = normalizeAssignmentId(primary_staff_id);
  const normalizedBackupStaffId = normalizeAssignmentId(backup_staff_id);
  const careTeamPharmacistIds = [
    normalizedPrimaryPharmacistId,
    normalizedBackupPharmacistId,
  ].filter((value): value is string => Boolean(value));
  const careTeamStaffIds = [normalizedPrimaryStaffId, normalizedBackupStaffId].filter(
    (value): value is string => Boolean(value),
  );
  if (careTeamPharmacistIds.length > 0 || careTeamStaffIds.length > 0) {
    const refResult = await validateOrgReferences(ctx.orgId, {
      ...(careTeamPharmacistIds.length > 0 ? { pharmacist_ids: careTeamPharmacistIds } : {}),
      ...(careTeamStaffIds.length > 0 ? { staff_ids: careTeamStaffIds } : {}),
    });
    if (!refResult.ok) return refResult.response;
  }
  const nextName = rest.name ?? existing.name;
  const nextGender = rest.gender ?? existing.gender;
  const nextBirthDateKey =
    birth_date ??
    (existing.birth_date instanceof Date
      ? format(existing.birth_date, 'yyyy-MM-dd')
      : String(existing.birth_date).slice(0, 10));
  const identityChanged =
    rest.name !== undefined || rest.gender !== undefined || birth_date !== undefined;
  const duplicateBirthDate = identityChanged
    ? parsePatientDuplicateBirthDate(nextBirthDateKey)
    : null;
  if (identityChanged && !duplicateBirthDate) return validationError('生年月日の形式が不正です');
  const duplicateCandidates =
    identityChanged && duplicateBirthDate
      ? await findPatientDuplicateCandidates(prisma, {
          orgId: ctx.orgId,
          name: nextName,
          birthDate: duplicateBirthDate,
          gender: nextGender,
          excludePatientId: id,
          access: {
            userId: ctx.userId,
            role: ctx.role,
          },
        })
      : [];
  if (duplicateCandidates.length > 0 && !duplicateAcknowledged) {
    return conflict('重複している可能性がある患者が存在します', {
      duplicate_type: 'patient_identity',
      duplicates: duplicateCandidates,
    });
  }

  try {
    const patient = await withOrgContext(
      ctx.orgId,
      async (tx) => {
        // 患者項目の業務差分履歴(層b/層c)。各更新サイトで old→new を算出し、tx 末尾で一括追記する。
        const revisionEntries: PatientFieldRevisionEntry[] = [];
        const revisionDate = utcDateFromLocalKey(localDateKey());

        // 反映導線の出所(source_visit_record_id)は provenance 汚染を防ぐため、
        // 同一 org かつ同一患者の訪問記録に限り採用する(他患者/他org/不正IDは無視)。
        let effectiveSourceVisitRecordId: string | null = null;
        if (source_visit_record_id) {
          const sourceVisit = await tx.visitRecord.findFirst({
            where: { id: source_visit_record_id, org_id: ctx.orgId, patient_id: id },
            select: { id: true },
          });
          effectiveSourceVisitRecordId = sourceVisit?.id ?? null;
        }

        const primaryResidence = await tx.residence.findFirst({
          where: { patient_id: id, is_primary: true },
          select: {
            id: true,
            address: true,
            building_id: true,
            facility_id: true,
            facility_unit_id: true,
            unit_name: true,
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
            ...(normalizedPrimaryPharmacistId !== undefined
              ? { primary_pharmacist_id: normalizedPrimaryPharmacistId }
              : {}),
            ...(normalizedBackupPharmacistId !== undefined
              ? { backup_pharmacist_id: normalizedBackupPharmacistId }
              : {}),
            ...(normalizedPrimaryStaffId !== undefined
              ? { primary_staff_id: normalizedPrimaryStaffId }
              : {}),
            ...(normalizedBackupStaffId !== undefined
              ? { backup_staff_id: normalizedBackupStaffId }
              : {}),
            ...rest,
          } as Prisma.PatientUpdateInput,
        });

        // (基本情報) Patient スカラ項目の差分を履歴化。
        // 保険番号は PatientInsurance のテンポラル行がSoTのため、ここでは記録しない(二重実装回避)。
        const basicFieldLabels: Record<string, string> = {
          name: '氏名',
          name_kana: 'フリガナ',
          gender: '性別',
          phone: '電話番号',
          billing_support_flag: '請求支援フラグ',
          allergy_info: 'アレルギー情報',
          notes: 'メモ',
        };
        const restRecord = rest as Record<string, unknown>;
        for (const [fieldKey, fieldLabel] of Object.entries(basicFieldLabels)) {
          if (restRecord[fieldKey] === undefined) continue;
          revisionEntries.push({
            category: 'basic',
            field_key: fieldKey,
            field_label: fieldLabel,
            old_value: (existing as Record<string, unknown>)[fieldKey] ?? null,
            new_value: restRecord[fieldKey] ?? null,
          });
        }
        if (birth_date !== undefined) {
          revisionEntries.push({
            category: 'basic',
            field_key: 'birth_date',
            field_label: '生年月日',
            old_value:
              existing.birth_date instanceof Date
                ? format(existing.birth_date, 'yyyy-MM-dd')
                : (existing.birth_date ?? null),
            new_value: birth_date,
          });
        }

        // 担当チーム（患者単位）の変更を履歴化（audit by default）。
        const careTeamRevisionFields: Array<{
          key:
            | 'primary_pharmacist_id'
            | 'backup_pharmacist_id'
            | 'primary_staff_id'
            | 'backup_staff_id';
          label: string;
          value: string | null | undefined;
        }> = [
          {
            key: 'primary_pharmacist_id',
            label: '主担当薬剤師',
            value: normalizedPrimaryPharmacistId,
          },
          {
            key: 'backup_pharmacist_id',
            label: '副担当薬剤師',
            value: normalizedBackupPharmacistId,
          },
          { key: 'primary_staff_id', label: '主担当スタッフ', value: normalizedPrimaryStaffId },
          { key: 'backup_staff_id', label: '副担当スタッフ', value: normalizedBackupStaffId },
        ];
        for (const { key, label, value } of careTeamRevisionFields) {
          if (value === undefined) continue;
          revisionEntries.push({
            category: 'basic',
            field_key: key,
            field_label: label,
            old_value: (existing as Record<string, unknown>)[key] ?? null,
            new_value: value ?? null,
          });
        }

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

          // (居住情報) 提供された項目のみ差分を履歴化
          if (address !== undefined) {
            revisionEntries.push({
              category: 'residence',
              field_key: 'address',
              field_label: '住所',
              old_value: primaryResidence?.address ?? null,
              new_value: address ?? null,
            });
          }
          if (building_id !== undefined) {
            revisionEntries.push({
              category: 'residence',
              field_key: 'building_id',
              field_label: '建物',
              old_value: primaryResidence?.building_id ?? null,
              new_value: building_id || null,
            });
          }
          if (facility_id !== undefined) {
            revisionEntries.push({
              category: 'residence',
              field_key: 'facility_id',
              field_label: '施設',
              old_value: currentFacilityId,
              new_value: nextFacilityId,
            });
          }
          // DB 更新条件と揃える: facility 変更で unit が暗黙クリアされる場合も履歴化する
          if (
            facility_unit_id !== undefined ||
            (facility_id !== undefined && nextFacilityId !== currentFacilityId)
          ) {
            revisionEntries.push({
              category: 'residence',
              field_key: 'facility_unit_id',
              field_label: '施設ユニット',
              old_value: primaryResidence?.facility_unit_id ?? null,
              new_value: nextFacilityUnitId,
            });
          }
          if (unit_name !== undefined) {
            revisionEntries.push({
              category: 'residence',
              field_key: 'unit_name',
              field_label: '部屋番号',
              old_value: primaryResidence?.unit_name ?? null,
              new_value: unit_name || null,
            });
          }
        }

        if (contacts) {
          // 破壊的置換(deleteMany+createMany)で旧値が失われるため、置換前にスナップショットを取り履歴化する。
          // (ContactParty は audit トリガ対象外なので、本履歴が唯一の変更痕跡となる)
          const previousContacts = await tx.contactParty.findMany({
            where: { org_id: ctx.orgId, patient_id: id },
            select: {
              name: true,
              relation: true,
              phone: true,
              email: true,
              fax: true,
              organization_name: true,
              department: true,
              address: true,
              is_primary: true,
              is_emergency_contact: true,
              notes: true,
            },
            orderBy: { created_at: 'asc' },
          });
          const nextContacts = normalizePatientPrimaryContacts(
            contacts.map((contact) => ({
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
          );

          await tx.contactParty.deleteMany({
            where: { org_id: ctx.orgId, patient_id: id },
          });
          if (nextContacts.length > 0) {
            await tx.contactParty.createMany({
              data: nextContacts.map((contact) => ({
                org_id: ctx.orgId,
                patient_id: id,
                ...contact,
              })),
            });
          }

          revisionEntries.push({
            category: 'contacts',
            field_key: 'contacts',
            field_label: '連絡先',
            // 順序のみの差(UI 並び替え/GET と保存経路の orderBy 差)で偽の履歴を出さないため安定ソートして比較・保存する
            old_value: previousContacts.length > 0 ? sortJsonArrayStable(previousContacts) : null,
            new_value: nextContacts.length > 0 ? sortJsonArrayStable(nextContacts) : null,
          });
        }

        if (conditions) {
          // 連絡先と同様、破壊的置換の前に旧値スナップショットを取得して履歴化する(PatientCondition も audit 対象外)
          const previousConditions = await tx.patientCondition.findMany({
            where: { org_id: ctx.orgId, patient_id: id },
            select: {
              condition_type: true,
              name: true,
              is_primary: true,
              is_active: true,
              noted_at: true,
              notes: true,
            },
            orderBy: { created_at: 'asc' },
          });

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

          // 比較の安定化のため noted_at は日付文字列へ正規化したスナップショットで保持する
          const normalizeConditionSnapshot = (condition: {
            condition_type: unknown;
            name: unknown;
            is_primary: unknown;
            is_active: unknown;
            noted_at?: Date | string | null;
            notes?: unknown;
          }) => ({
            condition_type: condition.condition_type,
            name: condition.name,
            is_primary: condition.is_primary,
            is_active: condition.is_active,
            noted_at: condition.noted_at
              ? format(new Date(condition.noted_at), 'yyyy-MM-dd')
              : null,
            notes: condition.notes ?? null,
          });
          // 順序のみの差(GET は is_primary desc, 保存経路は created_at asc)で偽の履歴を出さないため安定ソートする
          const previousSnapshot = sortJsonArrayStable(
            previousConditions.map(normalizeConditionSnapshot),
          );
          const nextSnapshot = sortJsonArrayStable(conditions.map(normalizeConditionSnapshot));
          revisionEntries.push({
            category: 'conditions',
            field_key: 'conditions',
            field_label: '病名・問題',
            old_value: previousSnapshot.length > 0 ? previousSnapshot : null,
            new_value: nextSnapshot.length > 0 ? nextSnapshot : null,
          });
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
          // (臨床項目) 介護度/ADL/認知症度/嚥下/感染隔離 の差分を履歴化する。
          // PatientSchedulePreference は audit トリガ対象外のため本履歴が唯一の変更痕跡。
          // 値は期間で変わるため writePatientFieldRevisions の valid_from/valid_to で時点管理される。
          const clinicalFieldLabels: Record<string, string> = {
            care_level: '介護度',
            adl_level: 'ADL',
            dementia_level: '認知症度',
            swallowing_route: '嚥下',
            infection_isolation: '感染隔離',
          };
          const patchRecord = schedulePreferencePatchData as Record<string, unknown>;
          const hasClinicalChange = Object.keys(clinicalFieldLabels).some(
            (key) => key in schedulePreferencePatchData,
          );
          // upsert が上書きする前に旧値を取得する
          const existingPreference = hasClinicalChange
            ? await tx.patientSchedulePreference.findUnique({
                where: { patient_id: id },
                select: {
                  care_level: true,
                  adl_level: true,
                  dementia_level: true,
                  swallowing_route: true,
                  infection_isolation: true,
                },
              })
            : null;
          const existingRecord = existingPreference as Record<string, unknown> | null;
          for (const [fieldKey, fieldLabel] of Object.entries(clinicalFieldLabels)) {
            if (!(fieldKey in schedulePreferencePatchData)) continue;
            revisionEntries.push({
              category: 'clinical',
              field_key: fieldKey,
              field_label: fieldLabel,
              old_value: existingRecord?.[fieldKey] ?? null,
              new_value: patchRecord[fieldKey] ?? null,
            });
          }

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

            // 在宅医療処置/麻薬を構造化テーブルへ反映(JSON継続SoT・追加レイヤ)。追加(=開始)は確認タスク化する。
            const structuredCare = await syncStructuredHomeCare(tx, {
              orgId: ctx.orgId,
              patientId: id,
              caseId: activeCase.id,
              intake: nextHomeVisitIntake,
              source: effectiveSourceVisitRecordId ? 'visit_record' : 'patient_detail_edit',
              confirmedBy: ctx.userId,
              startDate: revisionDate,
            });
            if (structuredCare.proceduresAdded.includes('tpn')) {
              await upsertOperationalTask(tx, {
                orgId: ctx.orgId,
                taskType: 'patient_change_review',
                title: 'TPN開始: 無菌調製体制・物品を確認',
                priority: 'high',
                dedupeKey: `patient-tpn-start-review:${id}`,
                relatedEntityType: 'patient',
                relatedEntityId: id,
              });
            }
            if (structuredCare.narcoticsAdded.length > 0) {
              await upsertOperationalTask(tx, {
                orgId: ctx.orgId,
                taskType: 'patient_change_review',
                title: '麻薬開始: 残数確認・管理者・保管方法を確認',
                priority: 'high',
                dedupeKey: `patient-narcotic-start-review:${id}`,
                relatedEntityType: 'patient',
                relatedEntityId: id,
              });
            }
          }
        }

        const closeActiveInsuranceRows = (
          insuranceType: 'medical' | 'care',
          extraWhere: Prisma.PatientInsuranceWhereInput = {},
        ) =>
          tx.patientInsurance.updateMany({
            where: {
              org_id: ctx.orgId,
              patient_id: id,
              insurance_type: insuranceType,
              is_active: true,
              ...extraWhere,
            },
            data: {
              is_active: false,
              valid_until: revisionDate,
            },
          });

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
              // Close ALL active rows for this insurance type (Fix #3: multi-active guard)
              await closeActiveInsuranceRows(insuranceType);

              // Create new active row
              await tx.patientInsurance.create({
                data: {
                  org_id: ctx.orgId,
                  patient_id: id,
                  insurance_type: insuranceType,
                  number: nextNumber,
                  valid_from: revisionDate,
                  is_active: true,
                },
              });
            } else if (currentInsurance) {
              // If stale duplicate active rows exist, keep the current row and close the rest.
              await closeActiveInsuranceRows(insuranceType, { id: { not: currentInsurance.id } });
            }
          } else {
            await closeActiveInsuranceRows(insuranceType);
          }
        }

        // 変更があった項目のみ業務差分履歴(層b)+時点管理(層c)を追記する。
        // 差分は上の各更新サイトで算出済み。本呼び出しはDBを再読込しない(二重実装回避)。
        if (revisionEntries.length > 0) {
          await writePatientFieldRevisions(tx, {
            orgId: ctx.orgId,
            patientId: id,
            actorId: ctx.userId,
            validFrom: revisionDate,
            // 反映導線(訪問記録→患者詳細)経由の更新は出所を visit_record として記録する
            source: effectiveSourceVisitRecordId ? 'visit_record' : undefined,
            sourceVisitRecordId: effectiveSourceVisitRecordId ?? undefined,
            entries: revisionEntries,
          });

          // 重要な変更は確認タスクを自動生成する(dedupe_key で冪等)。
          // 実変更のみ対象とするため writePatientFieldRevisions と同じ no-op フィルタを再適用する。
          const changedFieldKeys = new Set(
            revisionEntries
              .filter((entry) => !isJsonEqual(entry.old_value, entry.new_value))
              .map((entry) => entry.field_key),
          );
          if (changedFieldKeys.has('care_level')) {
            await upsertOperationalTask(tx, {
              orgId: ctx.orgId,
              taskType: 'patient_change_review',
              title: '介護度の変更: 保険・算定区分を確認',
              priority: 'normal',
              dedupeKey: `patient-care-level-review:${id}`,
              relatedEntityType: 'patient',
              relatedEntityId: id,
            });
          }
          if (changedFieldKeys.has('facility_id')) {
            await upsertOperationalTask(tx, {
              orgId: ctx.orgId,
              taskType: 'patient_change_review',
              title: '居住・施設の変更: 単一建物人数を確認',
              priority: 'normal',
              dedupeKey: `patient-residence-review:${id}`,
              relatedEntityType: 'patient',
              relatedEntityId: id,
            });
          }
        }

        return updated;
      },
      { requestContext: ctx },
    );

    return success({
      ...patient,
      warnings:
        duplicateCandidates.length > 0
          ? [
              {
                code: 'PATIENT_DUPLICATE_ACKNOWLEDGED',
                severity: 'warning',
                message: '重複候補を確認済みとして患者情報を更新しました。',
              },
            ]
          : [],
      metadata: {
        duplicate_candidates: duplicateCandidates,
      },
    });
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

export async function PATCH(
  req: NextRequest,
  routeContext: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    return withSensitiveNoStore(await authenticatedPATCH(req, routeContext));
  } catch (err) {
    unstable_rethrow(err);
    return withSensitiveNoStore(internalError());
  }
}
