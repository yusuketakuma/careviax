import type { Prisma } from '@prisma/client';
import {
  assertFacilityReference,
  assertFacilityUnitReference,
  getFacilityVisitDefaults,
} from '@/lib/patient/facility-reference';
import { withOrgContext } from '@/lib/db/rls';
import { toPrismaJsonInput } from '@/lib/db/json';
import { createPatientSchema } from '@/lib/validations/patient';
import { formatDateKey } from '@/lib/date-key';
import { enqueuePatientCreatedWebhook } from '@/server/services/outbound-webhook-queue';
import type { z } from 'zod';
import {
  normalizeCareTeamPrimaryByRole,
  normalizePatientPrimaryContacts,
} from '@/lib/patient/care-team-contact';

export function compactObject<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

export function deriveBirthDate(rawBirthDate: string | undefined, reportedAge?: number) {
  if (rawBirthDate) return rawBirthDate;
  if (typeof reportedAge === 'number' && Number.isFinite(reportedAge)) {
    const today = new Date();
    return formatDateKey(new Date(today.getFullYear() - reportedAge, 0, 1));
  }
  return undefined;
}

export function derivePackagingMethod(intake?: { medication_support_methods?: string[] }) {
  const methods = intake?.medication_support_methods ?? [];
  if (methods.includes('unit_dose')) return 'unit_dose';
  if (methods.includes('calendar')) return 'calendar_pack';
  if (methods.includes('box')) return 'medication_box';
  if (methods.includes('crush')) return 'crush_and_pack';
  return null;
}

export type CreatePatientData = z.infer<typeof createPatientSchema>;

export async function createPatientWithIntake(orgId: string, data: CreatePatientData) {
  const {
    address,
    birth_date,
    intake,
    requester,
    primary_pharmacist_id,
    backup_pharmacist_id,
    primary_staff_id,
    backup_staff_id,
    ...rest
  } = data;
  const normalizeAssignmentId = (value: string | undefined) =>
    value === undefined || value === '' ? null : value;

  const preparedContacts =
    rest.contacts?.map((contact) => ({
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
    })) ?? [];

  if (intake?.emergency_contact?.name) {
    preparedContacts.push({
      name: intake.emergency_contact.name,
      relation: 'other',
      phone: intake.emergency_contact.phone || null,
      email: null,
      fax: null,
      organization_name: null,
      department: null,
      address: null,
      is_primary: false,
      is_emergency_contact: true,
      notes: intake.emergency_contact.relation || null,
    });
  }
  const normalizedContacts = normalizePatientPrimaryContacts(preparedContacts);

  const normalizedConditions =
    rest.conditions?.map((condition) => ({
      condition_type: condition.condition_type,
      name: condition.name,
      is_primary: condition.is_primary,
      is_active: condition.is_active,
      noted_at: condition.noted_at ? new Date(condition.noted_at) : null,
      notes: condition.notes || null,
    })) ?? [];

  if (intake?.primary_disease) {
    normalizedConditions.unshift({
      condition_type: 'disease',
      name: intake.primary_disease,
      is_primary: true,
      is_active: true,
      noted_at: null,
      notes: null,
    });
  }

  const packagingMethod = derivePackagingMethod(intake);
  const preferredContactPhone =
    intake?.contact_phone || rest.phone || intake?.contact_mobile || null;
  const homeVisitIntake = compactObject({
    requester: requester
      ? compactObject({
          organization_name: requester.organization_name,
          profession: requester.profession,
          contact_name: requester.contact_name,
          contact_name_kana: requester.contact_name_kana,
          phone: requester.phone,
          fax: requester.fax,
          pharmacy_decision_due_date: requester.pharmacy_decision_due_date,
          preferred_contact_method: requester.preferred_contact_method,
          preferred_contact_method_other: requester.preferred_contact_method_other,
        })
      : undefined,
    reported_age: intake?.age,
    primary_disease: intake?.primary_disease,
    postal_code: intake?.postal_code,
    housing_type: intake?.housing_type,
    facility_name: intake?.facility_name,
    mcs_linked: intake?.mcs_linked,
    primary_contact_preference: intake?.primary_contact_preference,
    contact_phone: intake?.contact_phone,
    contact_mobile: intake?.contact_mobile,
    emergency_contact: intake?.emergency_contact
      ? compactObject({
          name: intake.emergency_contact.name,
          relation: intake.emergency_contact.relation,
          phone: intake.emergency_contact.phone,
        })
      : undefined,
    visit_before_contact_required: intake?.visit_before_contact_required,
    first_visit_date: intake?.first_visit_preferred_date,
    first_visit_time_slot: intake?.first_visit_time_slot,
    first_visit_time_note: intake?.first_visit_time_note,
    money_management: intake?.money_management,
    parking_available: intake?.parking_available,
    family_key_person: intake?.family_key_person,
    care_level: intake?.care_level,
    adl_level: intake?.adl_level,
    dementia_level: intake?.dementia_level,
    medication_support_methods: intake?.medication_support_methods,
    medication_support_other: intake?.medication_support_other,
    ent_prescription: intake?.ent_prescription,
    ent_period_from: intake?.ent_period_from,
    ent_period_to: intake?.ent_period_to,
    narcotics_base: intake?.narcotics_base,
    narcotics_rescue: intake?.narcotics_rescue,
    allergy_history: intake?.allergy_history,
    infection_isolation: intake?.infection_isolation,
    swallowing_route: intake?.swallowing_route,
    residual_medication_status: intake?.residual_medication_status,
    other_clinical_notes: intake?.other_clinical_notes,
    special_medical_procedures: intake?.special_medical_procedures,
    special_medical_notes: intake?.special_medical_notes,
    home_care_status: intake?.home_care_status,
    home_start_date: intake?.home_start_date,
    home_end_date: intake?.home_end_date,
    home_end_reason: intake?.home_end_reason,
    emergency_response: intake?.emergency_response,
    after_hours_explanation_date: intake?.after_hours_explanation_date,
    patient_tags: intake?.patient_tags,
    visit_frequency: intake?.visit_frequency,
    regular_visit_slot: intake?.regular_visit_slot,
    visit_available_time_note: intake?.visit_available_time_note,
    access_key_info: intake?.access_key_info,
    medication_handover_place: intake?.medication_handover_place,
    medication_storage_location: intake?.medication_storage_location,
    collection_method: intake?.collection_method,
    payer: intake?.payer,
    medication_manager: intake?.medication_manager,
    medication_ability: intake?.medication_ability,
    missed_dose_pattern: intake?.missed_dose_pattern,
    residual_medication_pattern: intake?.residual_medication_pattern,
    residual_medication_checked_on: intake?.residual_medication_checked_on,
    residual_adjustment_status: intake?.residual_adjustment_status,
    crushing_check_status: intake?.crushing_check_status,
    simple_suspension_check_status: intake?.simple_suspension_check_status,
    egfr_value: intake?.egfr_value,
    egfr_measured_on: intake?.egfr_measured_on,
    weight_kg: intake?.weight_kg,
    weight_measured_on: intake?.weight_measured_on,
    high_risk_drug_flags: intake?.high_risk_drug_flags,
    adverse_monitoring_items: intake?.adverse_monitoring_items,
    pain_score: intake?.pain_score,
    rescue_use_count_recent: intake?.rescue_use_count_recent,
    constipation_status: intake?.constipation_status,
    drowsiness_delirium_status: intake?.drowsiness_delirium_status,
    fall_risk: intake?.fall_risk,
    pressure_ulcer_status: intake?.pressure_ulcer_status,
    medical_material_supplier: intake?.medical_material_supplier,
    material_exchange_due_note: intake?.material_exchange_due_note,
    device_vendor_contact: intake?.device_vendor_contact,
    document_status_note: intake?.document_status_note,
    report_destination_note: intake?.report_destination_note,
    emergency_policy_note: intake?.emergency_policy_note,
    interprofessional_action_note: intake?.interprofessional_action_note,
    home_pharmacy_add_on_2: intake?.home_pharmacy_add_on_2,
    intake_note: intake?.intake_note,
    care_manager: intake?.care_manager
      ? compactObject({
          name: intake.care_manager.name,
          name_kana: intake.care_manager.name_kana,
          organization_name: intake.care_manager.organization_name,
          phone: intake.care_manager.phone,
          fax: intake.care_manager.fax,
        })
      : undefined,
    visiting_nurse: intake?.visiting_nurse
      ? compactObject({
          name: intake.visiting_nurse.name,
          name_kana: intake.visiting_nurse.name_kana,
          organization_name: intake.visiting_nurse.organization_name,
          phone: intake.visiting_nurse.phone,
          fax: intake.visiting_nurse.fax,
        })
      : undefined,
    initial_transition_management_expected: intake?.initial_transition_management_expected,
  });

  const patient = await withOrgContext(orgId, async (tx) => {
    const facilityId = rest.facility_id || null;
    const facilityUnitId = rest.facility_unit_id || null;

    await assertFacilityReference(tx, orgId, facilityId);
    await assertFacilityUnitReference(tx, orgId, facilityId, facilityUnitId);

    const facilityVisitDefaults = await getFacilityVisitDefaults(tx, orgId, facilityId);

    const newPatient = await tx.patient.create({
      data: {
        org_id: orgId,
        birth_date: new Date(birth_date),
        name: rest.name,
        name_kana: rest.name_kana,
        gender: rest.gender,
        phone: preferredContactPhone,
        medical_insurance_number: rest.medical_insurance_number || null,
        care_insurance_number: rest.care_insurance_number || null,
        billing_support_flag: rest.billing_support_flag ?? false,
        primary_pharmacist_id: normalizeAssignmentId(primary_pharmacist_id),
        backup_pharmacist_id: normalizeAssignmentId(backup_pharmacist_id),
        primary_staff_id: normalizeAssignmentId(primary_staff_id),
        backup_staff_id: normalizeAssignmentId(backup_staff_id),
        allergy_info: rest.allergy_info ? toPrismaJsonInput(rest.allergy_info) : undefined,
        notes: rest.notes || null,
      },
    });

    // Write PatientInsurance records from denormalized insurance numbers
    const insuranceRecords: Prisma.PatientInsuranceCreateManyInput[] = [];
    if (rest.medical_insurance_number) {
      insuranceRecords.push({
        org_id: orgId,
        patient_id: newPatient.id,
        insurance_type: 'medical',
        number: rest.medical_insurance_number,
        is_active: true,
      });
    }
    if (rest.care_insurance_number) {
      insuranceRecords.push({
        org_id: orgId,
        patient_id: newPatient.id,
        insurance_type: 'care',
        number: rest.care_insurance_number,
        is_active: true,
      });
    }
    if (insuranceRecords.length > 0) {
      await tx.patientInsurance.createMany({ data: insuranceRecords });
    }

    const residenceAddress =
      address ||
      (facilityId
        ? (
            await tx.facility.findFirst({
              where: { id: facilityId, org_id: orgId },
              select: { address: true },
            })
          )?.address || ''
        : '');

    if (residenceAddress || rest.building_id || facilityId || facilityUnitId || rest.unit_name) {
      await tx.residence.create({
        data: {
          org_id: orgId,
          patient_id: newPatient.id,
          address: residenceAddress,
          building_id: rest.building_id || intake?.facility_name || null,
          facility_id: facilityId,
          facility_unit_id: facilityUnitId,
          unit_name: rest.unit_name || null,
          is_primary: true,
        },
      });
    }

    if (normalizedContacts.length > 0) {
      await tx.contactParty.createMany({
        data: normalizedContacts.map((contact) => ({
          org_id: orgId,
          patient_id: newPatient.id,
          ...contact,
        })) as Prisma.ContactPartyCreateManyInput[],
      });
    }

    if (normalizedConditions.length > 0) {
      await tx.patientCondition.createMany({
        data: normalizedConditions.map((condition) => ({
          org_id: orgId,
          patient_id: newPatient.id,
          ...condition,
        })) as Prisma.PatientConditionCreateManyInput[],
      });
    }

    if (packagingMethod) {
      await tx.patientPackagingProfile.create({
        data: {
          org_id: orgId,
          patient_id: newPatient.id,
          default_packaging_method: packagingMethod,
        },
      });
    }

    if (
      intake ||
      requester ||
      facilityVisitDefaults?.acceptance_time_from ||
      facilityVisitDefaults?.acceptance_time_to
    ) {
      await tx.patientSchedulePreference.create({
        data: {
          org_id: orgId,
          patient_id: newPatient.id,
          facility_time_from: facilityVisitDefaults?.acceptance_time_from ?? null,
          facility_time_to: facilityVisitDefaults?.acceptance_time_to ?? null,
          preferred_contact_phone: preferredContactPhone,
          preferred_contact_name:
            requester?.contact_name || intake?.emergency_contact?.name || null,
          primary_contact_preference: intake?.primary_contact_preference || null,
          visit_before_contact_required: intake?.visit_before_contact_required ?? null,
          first_visit_preferred_date: intake?.first_visit_preferred_date
            ? new Date(intake.first_visit_preferred_date)
            : null,
          first_visit_time_slot: intake?.first_visit_time_slot || null,
          first_visit_time_note: intake?.first_visit_time_note || null,
          parking_available: intake?.parking_available ?? null,
          mcs_linked: intake?.mcs_linked ?? null,
          // P-09: structured intake columns
          adl_level: intake?.adl_level || null,
          dementia_level: intake?.dementia_level || null,
          swallowing_route: intake?.swallowing_route || null,
          care_level: intake?.care_level || null,
          infection_isolation: !!intake?.infection_isolation,
        },
      });

      const careCase = await tx.careCase.create({
        data: {
          org_id: orgId,
          patient_id: newPatient.id,
          referral_source: requester?.organization_name || null,
          required_visit_support: toPrismaJsonInput({
            home_visit_intake: homeVisitIntake,
          }),
        },
      });

      const careTeamLinks = normalizeCareTeamPrimaryByRole(
        [
          intake?.care_manager?.name
            ? {
                role: 'care_manager',
                name: intake.care_manager.name,
                organization_name: intake.care_manager.organization_name || null,
                phone: intake.care_manager.phone || null,
                fax: intake.care_manager.fax || null,
                is_primary: true,
              }
            : null,
          intake?.visiting_nurse?.name
            ? {
                role: 'nurse',
                name: intake.visiting_nurse.name,
                organization_name: intake.visiting_nurse.organization_name || null,
                phone: intake.visiting_nurse.phone || null,
                fax: intake.visiting_nurse.fax || null,
                is_primary: true,
              }
            : null,
        ].filter((item): item is NonNullable<typeof item> => item != null),
      );

      if (careTeamLinks.length > 0) {
        await tx.careTeamLink.createMany({
          data: careTeamLinks.map((link) => ({
            org_id: orgId,
            case_id: careCase.id,
            role: link.role,
            name: link.name,
            organization_name: link.organization_name,
            phone: link.phone,
            fax: link.fax,
            is_primary: link.is_primary,
          })),
        });
      }
    }

    await enqueuePatientCreatedWebhook(tx, orgId, newPatient);

    return newPatient;
  });

  return patient;
}
