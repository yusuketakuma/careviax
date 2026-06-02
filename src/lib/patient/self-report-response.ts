import type { PatientPrivacyFlags } from '@/lib/patient/privacy';

export const MASKED_SELF_REPORT_CATEGORY = '非表示';
export const MASKED_SELF_REPORT_SUBJECT = '自己申告内容は非表示';

export const patientSelfReportResponseSelect = {
  id: true,
  patient_id: true,
  reported_by_name: true,
  relation: true,
  category: true,
  subject: true,
  content: true,
  requested_callback: true,
  preferred_contact_time: true,
  status: true,
  triaged_by: true,
  triaged_at: true,
  created_at: true,
  updated_at: true,
} as const;

type PatientSelfReportForResponse = {
  id: string;
  patient_id: string;
  reported_by_name: string;
  relation: string | null;
  category: string;
  subject: string;
  content: string;
  requested_callback: boolean;
  preferred_contact_time: string | null;
  status: string;
  triaged_by: string | null;
  triaged_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

type PatientDisplayForSelfReport = {
  name: string | null;
  name_kana: string | null;
};

export function serializePatientSelfReport(
  report: PatientSelfReportForResponse,
  privacy: PatientPrivacyFlags,
  patient?: PatientDisplayForSelfReport,
) {
  const masked = privacy.sensitiveFieldsMasked;

  return {
    id: report.id,
    patient_id: report.patient_id,
    reported_by_name: masked ? null : report.reported_by_name,
    relation: masked ? null : report.relation,
    category: masked ? MASKED_SELF_REPORT_CATEGORY : report.category,
    subject: masked ? MASKED_SELF_REPORT_SUBJECT : report.subject,
    content: masked ? null : report.content,
    requested_callback: report.requested_callback,
    preferred_contact_time: masked ? null : report.preferred_contact_time,
    status: report.status,
    triaged_by: report.triaged_by,
    triaged_at: report.triaged_at,
    created_at: report.created_at,
    updated_at: report.updated_at,
    sensitive_fields_masked: masked,
    ...(patient
      ? {
          patient_name: masked ? null : patient.name,
          patient_name_kana: masked ? null : patient.name_kana,
        }
      : {}),
  };
}
