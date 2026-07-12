'use client';

import { useQuery } from '@tanstack/react-query';
import { FileQuestion } from 'lucide-react';
import { z } from 'zod';
import { PatientForm } from '@/components/features/patients/patient-form';
import { Skeleton } from '@/components/ui/loading';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { readApiJson } from '@/lib/api/client-json';
import { buildOrgHeaders } from '@/lib/api/org-headers';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { getHomeVisitIntake } from '@/lib/patient/home-visit-intake';
import { buildPatientApiPath } from '@/lib/patient/api-paths';
import { buildPatientHref } from '@/lib/patient/navigation';
import { patientGenderSchema, type CreatePatientInput } from '@/lib/validations/patient';
import { allergyEntrySchema, type AllergyEntry } from '@/lib/validations/patient-allergy';

function PatientEditLoadingState() {
  return (
    <div
      className="mx-auto max-w-7xl space-y-6"
      role="status"
      aria-label="患者編集フォームを読み込み中"
      aria-live="polite"
    >
      <div className="space-y-2">
        <Skeleton className="h-6 w-44" />
        <Skeleton className="h-4 w-full max-w-xl" />
      </div>

      {Array.from({ length: 3 }).map((_, sectionIndex) => (
        <section
          key={sectionIndex}
          className="space-y-4 rounded-lg border border-border bg-card p-4"
          aria-hidden="true"
        >
          <div className="space-y-2">
            <Skeleton className="h-5 w-36" />
            <Skeleton className="h-4 w-64 max-w-full" />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {Array.from({ length: 4 }).map((__, fieldIndex) => (
              <div key={fieldIndex} className="space-y-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-11 w-full rounded-md" />
              </div>
            ))}
          </div>
        </section>
      ))}

      <div className="flex justify-end gap-3" aria-hidden="true">
        <Skeleton className="h-11 w-24 rounded-md" />
        <Skeleton className="h-11 w-28 rounded-md" />
      </div>
      <span className="sr-only">患者編集フォームを読み込み中</span>
    </div>
  );
}

export function normalizeAllergyInfoForPatientForm(
  allergyInfo: unknown,
): AllergyEntry[] | undefined {
  if (allergyInfo == null) return undefined;

  const parsed = allergyEntrySchema.array().safeParse(allergyInfo);
  return parsed.success ? parsed.data : undefined;
}

const patientEditSchedulingPreferenceSchema = z.object({
  primary_contact_preference: z.string().nullable(),
  visit_before_contact_required: z.boolean().nullable(),
  first_visit_preferred_date: z.string().nullable(),
  first_visit_time_slot: z.string().nullable(),
  first_visit_time_note: z.string().nullable(),
  care_level: z.string().nullable(),
  adl_level: z.string().nullable(),
  dementia_level: z.string().nullable(),
  parking_available: z.boolean().nullable(),
  mcs_linked: z.boolean().nullable(),
  swallowing_route: z.string().nullable(),
  infection_isolation: z.boolean(),
});

const patientEditOverviewSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  name_kana: z.string(),
  birth_date: z.union([z.string().date(), z.string().datetime()]),
  gender: patientGenderSchema,
  phone: z.string().nullable(),
  medical_insurance_number: z.string().nullable(),
  care_insurance_number: z.string().nullable(),
  billing_support_flag: z.boolean(),
  allergy_info: z.unknown().nullable(),
  notes: z.string().nullable(),
  updated_at: z.string().datetime(),
  primary_pharmacist_id: z.string().nullable(),
  backup_pharmacist_id: z.string().nullable(),
  primary_staff_id: z.string().nullable(),
  backup_staff_id: z.string().nullable(),
  residences: z.array(
    z.object({
      address: z.string(),
      building_id: z.string().nullable(),
      facility_id: z.string().nullable(),
      facility_unit_id: z.string().nullable(),
      unit_name: z.string().nullable(),
      is_primary: z.boolean(),
    }),
  ),
  cases: z.array(z.object({ required_visit_support: z.unknown().nullable() })),
  scheduling_preference: patientEditSchedulingPreferenceSchema.nullable(),
});
const patientEditResponseSchema = z.object({ data: patientEditOverviewSchema }).strict();

type PatientEditOverview = z.infer<typeof patientEditOverviewSchema>;

function buildDefaultValues(patient: PatientEditOverview): Partial<CreatePatientInput> {
  const primaryResidence = patient.residences.find((residence) => residence.is_primary) ?? null;
  const intakeCase =
    patient.cases.find((careCase) => getHomeVisitIntake(careCase.required_visit_support)) ?? null;
  const intake = intakeCase ? getHomeVisitIntake(intakeCase.required_visit_support) : null;
  const pref = patient.scheduling_preference;
  const hasIntakeData = Boolean(intake || pref);
  const intakeDefaults = hasIntakeData
    ? ({
        age: intake?.reported_age,
        primary_disease: intake?.primary_disease,
        contact_phone: intake?.contact_phone,
        contact_mobile: intake?.contact_mobile,
        primary_contact_preference:
          pref?.primary_contact_preference ?? intake?.primary_contact_preference,
        visit_before_contact_required:
          pref?.visit_before_contact_required ?? intake?.visit_before_contact_required,
        first_visit_preferred_date: pref?.first_visit_preferred_date ?? intake?.first_visit_date,
        first_visit_time_slot: pref?.first_visit_time_slot ?? intake?.first_visit_time_slot,
        first_visit_time_note: pref?.first_visit_time_note ?? intake?.first_visit_time_note,
        care_level: pref?.care_level ?? intake?.care_level,
        adl_level: pref?.adl_level ?? intake?.adl_level,
        dementia_level: pref?.dementia_level ?? intake?.dementia_level,
        medication_support_methods: intake?.medication_support_methods,
        medication_support_other: intake?.medication_support_other,
        parking_available: pref?.parking_available ?? intake?.parking_available,
        mcs_linked: pref?.mcs_linked ?? intake?.mcs_linked,
        money_management: intake?.money_management,
        family_key_person: intake?.family_key_person,
        ent_prescription: intake?.ent_prescription,
        ent_period_from: intake?.ent_period_from,
        ent_period_to: intake?.ent_period_to,
        narcotics_base: intake?.narcotics_base,
        narcotics_rescue: intake?.narcotics_rescue,
        allergy_history: intake?.allergy_history,
        infection_isolation:
          intake?.infection_isolation ?? (pref?.infection_isolation ? '要隔離' : undefined),
        swallowing_route: pref?.swallowing_route ?? intake?.swallowing_route,
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
        care_manager: intake?.care_manager,
        visiting_nurse: intake?.visiting_nurse,
        postal_code: intake?.postal_code,
        housing_type: intake?.housing_type,
        facility_name: intake?.facility_name,
        emergency_contact: intake?.emergency_contact,
        initial_transition_management_expected: intake?.initial_transition_management_expected,
      } as NonNullable<CreatePatientInput['intake']>)
    : undefined;

  return {
    name: patient.name,
    name_kana: patient.name_kana,
    birth_date: patient.birth_date.slice(0, 10),
    gender: patient.gender,
    phone: patient.phone ?? undefined,
    medical_insurance_number: patient.medical_insurance_number ?? undefined,
    care_insurance_number: patient.care_insurance_number ?? undefined,
    billing_support_flag: patient.billing_support_flag,
    address: primaryResidence?.address ?? undefined,
    building_id: primaryResidence?.building_id ?? undefined,
    facility_id: primaryResidence?.facility_id ?? undefined,
    facility_unit_id: primaryResidence?.facility_unit_id ?? undefined,
    unit_name: primaryResidence?.unit_name ?? undefined,
    allergy_info: normalizeAllergyInfoForPatientForm(patient.allergy_info),
    notes: patient.notes ?? undefined,
    // 担当チーム（患者単位）を現在値で pre-populate（未選択='' での null 上書き=消失を防ぐ）。
    primary_pharmacist_id: patient.primary_pharmacist_id ?? undefined,
    backup_pharmacist_id: patient.backup_pharmacist_id ?? undefined,
    primary_staff_id: patient.primary_staff_id ?? undefined,
    backup_staff_id: patient.backup_staff_id ?? undefined,
    requester: intake?.requester
      ? {
          organization_name: intake.requester.organization_name,
          profession: intake.requester.profession,
          contact_name: intake.requester.contact_name,
          contact_name_kana: intake.requester.contact_name_kana,
          phone: intake.requester.phone,
          fax: intake.requester.fax,
          pharmacy_decision_due_date: intake.requester.pharmacy_decision_due_date,
          preferred_contact_method: intake.requester.preferred_contact_method,
          preferred_contact_method_other: intake.requester.preferred_contact_method_other,
        }
      : undefined,
    intake: intakeDefaults,
  };
}

export function PatientEditContent({ patientId }: { patientId: string }) {
  const orgId = useOrgId();

  const patientQuery = useQuery<PatientEditOverview>({
    queryKey: ['patient-overview', patientId, orgId],
    queryFn: async () => {
      const response = await fetch(buildPatientApiPath(patientId, '/overview'), {
        headers: buildOrgHeaders(orgId ?? ''),
      });
      const fallbackMessage = '患者情報の取得に失敗しました';
      const payload = await readApiJson<{ data: PatientEditOverview }>(response, {
        fallbackMessage,
        schema: patientEditResponseSchema,
      });
      if (payload.data.id !== patientId) throw new Error(fallbackMessage);
      return payload.data;
    },
    enabled: Boolean(orgId),
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  });

  if (!orgId || patientQuery.isLoading) {
    return <PatientEditLoadingState />;
  }

  if (patientQuery.error && !patientQuery.data) {
    return (
      <ErrorState
        variant="server"
        title="患者情報を表示できません"
        cause="患者情報の取得に失敗しました。"
        nextAction="通信状態を確認して再試行してください。"
        onRetry={() => void patientQuery.refetch()}
      />
    );
  }

  if (!patientQuery.data) {
    return <EmptyState icon={FileQuestion} title="患者情報が見つかりません" />;
  }

  return (
    <div className="mx-auto max-w-7xl">
      <PatientForm
        patientId={patientId}
        redirectTo={buildPatientHref(patientId)}
        defaultValues={buildDefaultValues(patientQuery.data)}
        expectedUpdatedAt={patientQuery.data.updated_at}
      />
    </div>
  );
}
