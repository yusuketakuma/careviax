import type { UpdatePatientData } from '@/lib/validations/patient';
import type { HomeVisitIntake } from '@/lib/patient/home-visit-intake';

type PatientRequesterPatch = NonNullable<UpdatePatientData['requester']>;
type PatientIntakePatch = NonNullable<UpdatePatientData['intake']>;

export function hasOwnKey<T extends object>(value: T, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

export function normalizeNullableText(value: string | null | undefined) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function validateMergedHomeVisitIntake(value: HomeVisitIntake | null): string[] {
  if (!value) return [];

  const periodFrom = normalizeNullableText(value.ent_period_from);
  const periodTo = normalizeNullableText(value.ent_period_to);
  const errors: string[] = [];
  if (periodFrom && periodTo && periodFrom > periodTo) {
    errors.push('在宅経管栄養期間の開始日は終了日以前である必要があります');
  }
  if (value.ent_prescription === true && !periodFrom && !periodTo) {
    errors.push('在宅経管栄養を有効にする場合は期間を指定してください');
  }
  return errors;
}

function assignOptionalField(target: object, key: string, value: unknown | undefined) {
  const targetRecord = target as Record<string, unknown>;
  if (value == null) {
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
  value: boolean | null | undefined,
  provided: boolean,
) {
  if (!provided) return;
  assignOptionalField(target, key, value);
}

function assignNumberField(
  target: object,
  key: string,
  value: number | null | undefined,
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
  value: string[] | null | undefined,
  provided: boolean,
) {
  if (!provided) return;
  assignOptionalField(target, key, Array.isArray(value) ? value : undefined);
}

function compactNestedObject<T extends object>(value: T) {
  const entries = Object.entries(value).filter(([, entry]) => entry !== undefined);
  return entries.length > 0 ? (Object.fromEntries(entries) as T) : undefined;
}

export function mergeHomeVisitIntake(args: {
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
