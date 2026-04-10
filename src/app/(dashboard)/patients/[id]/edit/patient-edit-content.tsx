'use client';

import { useQuery } from '@tanstack/react-query';
import { FileQuestion } from 'lucide-react';
import { PatientForm } from '@/components/features/patients/patient-form';
import { Loading } from '@/components/ui/loading';
import { EmptyState } from '@/components/ui/empty-state';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { getHomeVisitIntake } from '@/lib/patient/home-visit-intake';
import type { CreatePatientInput } from '@/lib/validations/patient';
import type { PatientOverview } from '../patient-detail.types';

function buildDefaultValues(patient: PatientOverview): Partial<CreatePatientInput> {
  const primaryResidence = patient.residences.find((residence) => residence.is_primary) ?? null;
  const intakeCase =
    patient.cases.find((careCase) => getHomeVisitIntake(careCase.required_visit_support)) ?? null;
  const intake = intakeCase ? getHomeVisitIntake(intakeCase.required_visit_support) : null;
  const pref = patient.scheduling_preference;
  const hasIntakeData = Boolean(intake || pref);

  return {
    name: patient.name,
    name_kana: patient.name_kana,
    birth_date: patient.birth_date.slice(0, 10),
    gender: patient.gender as CreatePatientInput['gender'],
    phone: patient.phone ?? undefined,
    medical_insurance_number: patient.medical_insurance_number ?? undefined,
    care_insurance_number: patient.care_insurance_number ?? undefined,
    billing_support_flag: patient.billing_support_flag,
    address: primaryResidence?.address ?? undefined,
    building_id: primaryResidence?.building_id ?? undefined,
    facility_id: primaryResidence?.facility_id ?? undefined,
    facility_unit_id: primaryResidence?.facility_unit_id ?? undefined,
    unit_name: primaryResidence?.unit_name ?? undefined,
    allergy_info: patient.allergy_info ?? undefined,
    notes: patient.notes ?? undefined,
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
    intake: hasIntakeData
      ? {
          age: intake?.reported_age,
          primary_disease: intake?.primary_disease,
          contact_phone: intake?.contact_phone,
          contact_mobile: intake?.contact_mobile,
          primary_contact_preference:
            pref?.primary_contact_preference ?? intake?.primary_contact_preference,
          visit_before_contact_required:
            pref?.visit_before_contact_required ?? intake?.visit_before_contact_required,
          first_visit_preferred_date: pref?.first_visit_preferred_date ?? intake?.first_visit_date,
          first_visit_time_slot: (pref?.first_visit_time_slot ?? intake?.first_visit_time_slot) as
            | 'morning'
            | 'afternoon'
            | 'specific'
            | undefined,
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
          intake_note: intake?.intake_note,
          care_manager: intake?.care_manager,
          visiting_nurse: intake?.visiting_nurse,
          postal_code: intake?.postal_code,
          housing_type: intake?.housing_type,
          facility_name: intake?.facility_name,
          emergency_contact: intake?.emergency_contact,
          initial_transition_management_expected: intake?.initial_transition_management_expected,
        }
      : undefined,
  };
}

export function PatientEditContent({ patientId }: { patientId: string }) {
  const orgId = useOrgId();

  const patientQuery = useQuery<PatientOverview>({
    queryKey: ['patient-overview', patientId, orgId],
    queryFn: async () => {
      const response = await fetch(`/api/patients/${patientId}/overview`, {
        headers: { 'x-org-id': orgId ?? '' },
      });
      if (!response.ok) throw new Error('患者情報の取得に失敗しました');
      return response.json();
    },
    enabled: Boolean(orgId),
  });

  if (!orgId || patientQuery.isLoading) {
    return <Loading label="患者情報を読み込み中..." />;
  }

  if (patientQuery.error instanceof Error || !patientQuery.data) {
    return (
      <EmptyState
        icon={FileQuestion}
        title="患者情報が見つかりません"
        description={
          patientQuery.error instanceof Error
            ? patientQuery.error.message
            : '患者情報を取得できませんでした。'
        }
      />
    );
  }

  return (
    <div className="mx-auto max-w-5xl">
      <PatientForm
        patientId={patientId}
        redirectTo={`/patients/${patientId}`}
        defaultValues={buildDefaultValues(patientQuery.data)}
      />
    </div>
  );
}
