import { z } from 'zod';
import type {
  AudienceReportContent,
  CareManagerReportContent,
  PhysicianReportContent,
} from '@/types/care-report-content';
import type { CareReport, ExternalProfessionalSuggestion } from './page';
import { careReportPdfReferenceSchema } from '@/lib/reports/pdf-reference-schema';

const text = (max = 1_000) => z.string().trim().min(1).max(max);
const nullableText = (max = 1_000) => z.string().max(max).nullable();
const dateTime = z.string().datetime({ offset: true });
const dateKey = z.string().date();
const channel = z.enum(['email', 'fax', 'phone', 'ses', 'portal', 'mail']);
const reportContentSchema = z.custom<
  PhysicianReportContent | CareManagerReportContent | AudienceReportContent
>((value) => typeof value === 'object' && value !== null && !Array.isArray(value));

const archiveSchema = z
  .object({
    status: z.enum(['active', 'archived']),
    archived: z.boolean(),
    archived_at: dateTime.nullable(),
  })
  .strict()
  .superRefine((archive, context) => {
    if (
      archive.archived !== (archive.status === 'archived') ||
      archive.archived !== (archive.archived_at !== null)
    )
      context.addIssue({ code: 'custom', message: 'Patient archive state drift' });
  });

const contactReliabilitySchema = z
  .object({
    ready: z.boolean(),
    warnings: z.array(text(2_000)).max(20),
    missing_channel_labels: z.array(text(500)).max(20),
  })
  .strict();

const externalProfessionalSuggestionProviderSchema = z
  .object({
    id: text(255),
    name: text(),
    profession_type: text(200),
    organization_name: nullableText(),
    department: nullableText(),
    phone: nullableText(200),
    email: z.string().email().max(500).nullable(),
    fax: nullableText(200),
    address: nullableText(2_000),
    preferred_contact_method: channel.nullable(),
    preferred_contact_time: nullableText(),
    last_contacted_at: dateTime.nullable(),
    last_success_channel: channel.nullable(),
    recommended_channels: z.array(channel).max(6),
    contact_reliability: contactReliabilitySchema,
    is_primary: z.boolean(),
    source: z.enum(['patient_care_team', 'external_professional_master']),
  })
  .strict();

function projectExternalProfessionalSuggestion(
  suggestion: z.infer<typeof externalProfessionalSuggestionProviderSchema>,
): ExternalProfessionalSuggestion {
  const { contact_reliability: reliability, ...consumed } = suggestion;
  void reliability;
  return consumed;
}

export const externalProfessionalSuggestionsResponseSchema = z
  .object({ data: z.array(externalProfessionalSuggestionProviderSchema).max(200) })
  .strict()
  .superRefine(({ data }, context) => {
    if (new Set(data.map((item) => item.id)).size !== data.length)
      context.addIssue({ code: 'custom', message: 'External professional identity drift' });
    const primaryProfessions = data
      .filter((item) => item.is_primary)
      .map((item) => item.profession_type);
    if (new Set(primaryProfessions).size !== primaryProfessions.length)
      context.addIssue({ code: 'custom', message: 'Multiple primary professionals' });
  })
  .transform(({ data }): { data: ExternalProfessionalSuggestion[] } => ({
    data: data.map(projectExternalProfessionalSuggestion),
  }));

const deliveryRecordSchema = z
  .object({
    id: text(255),
    channel: text(100),
    recipient_name: text(),
    recipient_contact: z.string().max(1_000).nullable(),
    status: text(100),
    sent_at: dateTime.nullable(),
    created_at: dateTime,
  })
  .strict();

const permissionsSchema = z
  .object({
    can_edit: z.boolean(),
    can_send: z.boolean(),
    can_create_external_share: z.boolean(),
    can_create_followup_task: z.boolean(),
    can_view_patient: z.boolean(),
    can_view_related_requests: z.boolean(),
  })
  .strict();

const prescriberSuggestionSchema = z
  .object({
    id: text(255),
    name: text(),
    phone: nullableText(200),
    fax: nullableText(200),
    address: nullableText(2_000),
    recommended_channels: z.array(channel).max(6),
    contact_reliability: contactReliabilitySchema,
    prescribed_date: dateTime,
    prescriber_name: nullableText(),
  })
  .strict();

const reportProviderSchema = z
  .object({
    id: text(255),
    patient_id: text(255),
    case_id: nullableText(255),
    visit_record_id: nullableText(255),
    report_type: z.enum([
      'physician_report',
      'care_manager_report',
      'facility_handoff',
      'nurse_share',
      'family_share',
      'internal_record',
    ]),
    status: z.enum(['draft', 'sent', 'failed', 'confirmed', 'response_waiting']),
    content: reportContentSchema.optional(),
    template_id: nullableText(255),
    pdf_url: careReportPdfReferenceSchema.nullable(),
    created_by: text(255),
    created_at: dateTime,
    updated_at: dateTime,
    delivery_records: z.array(deliveryRecordSchema).max(20),
    patient_summary: z
      .object({
        id: text(255),
        name: nullableText(),
        name_kana: nullableText(),
        birth_date: dateKey.nullable(),
        archive: archiveSchema,
      })
      .strict()
      .nullable(),
    visit_summary: z
      .object({ id: text(255), visit_date: dateTime })
      .strict()
      .nullable(),
    intake_baseline_context: z.record(z.string(), z.unknown()).nullable(),
    permissions: permissionsSchema,
    delivery_rule_suggestion: z
      .object({
        document_type: text(200),
        target_role: text(200),
        channel,
        fallback_channels: z.array(channel).max(6),
      })
      .strict()
      .nullable(),
    external_professional_suggestions: z
      .array(externalProfessionalSuggestionProviderSchema)
      .max(200),
    prescriber_institution_suggestion: prescriberSuggestionSchema.nullable(),
  })
  .strict()
  .superRefine((report, context) => {
    const canLoadContent = report.permissions.can_edit || report.permissions.can_send;
    if (
      canLoadContent !== (report.content !== undefined) ||
      (!report.permissions.can_send && report.pdf_url !== null) ||
      (!report.permissions.can_view_patient &&
        (report.patient_summary !== null || report.visit_summary !== null)) ||
      (!report.permissions.can_send &&
        (report.prescriber_institution_suggestion !== null ||
          report.external_professional_suggestions.length > 0 ||
          report.delivery_rule_suggestion !== null ||
          report.delivery_records.some((record) => record.recipient_contact !== null))) ||
      (report.patient_summary !== null && report.patient_summary.id !== report.patient_id) ||
      new Set(report.delivery_records.map((record) => record.id)).size !==
        report.delivery_records.length ||
      new Set(report.external_professional_suggestions.map((item) => item.id)).size !==
        report.external_professional_suggestions.length
    ) {
      context.addIssue({ code: 'custom', message: 'Care report visibility or identity drift' });
    }
  });

export function buildCareReportDetailResponseSchema(reportId: string) {
  return z
    .object({ data: reportProviderSchema })
    .strict()
    .superRefine(({ data }, context) => {
      if (data.id !== reportId)
        context.addIssue({
          code: 'custom',
          path: ['data', 'id'],
          message: 'Care report scope drift',
        });
    })
    .transform(({ data }): { data: CareReport } => {
      const {
        visit_record_id: visitRecordId,
        template_id: templateId,
        intake_baseline_context: intakeBaselineContext,
        external_professional_suggestions: suggestions,
        prescriber_institution_suggestion: prescriberSuggestion,
        ...consumed
      } = data;
      void visitRecordId;
      void templateId;
      void intakeBaselineContext;
      return {
        data: {
          ...consumed,
          external_professional_suggestions: suggestions.map(projectExternalProfessionalSuggestion),
          prescriber_institution_suggestion: prescriberSuggestion
            ? (() => {
                const { contact_reliability: reliability, ...projected } = prescriberSuggestion;
                void reliability;
                return projected;
              })()
            : null,
        },
      };
    });
}
