import { z } from 'zod';
import type { VisitBrief } from '@/types/visit-brief';

const text = (max = 1_000) => z.string().trim().min(1).max(max);
const nullableText = (max = 1_000) => z.string().max(max).nullable();
const count = z.number().int().nonnegative();
const dateTime = z.string().datetime({ offset: true });
const temporal = z.string().refine((value) => Number.isFinite(Date.parse(value)), 'Invalid date');
const internalHref = z
  .string()
  .max(2_000)
  .refine((value) => value.startsWith('/') && !value.startsWith('//'));
const boundedStrings = (maxItems = 50, maxLength = 1_000) => z.array(text(maxLength)).max(maxItems);

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
      context.addIssue({ code: 'custom', message: 'Visit brief archive state drift' });
  });

const baselineContextSchema = z
  .object({
    care_level: nullableText(),
    adl_level: nullableText(),
    dementia_level: nullableText(),
    medication_support_methods: boundedStrings(30),
    special_medical_procedures: boundedStrings(30),
    family_key_person: nullableText(),
    money_management: nullableText(),
    visit_before_contact_required: z.boolean().nullable(),
    narcotics_base: z.boolean().nullable(),
    narcotics_rescue: z.boolean().nullable(),
    infection_isolation: nullableText(),
  })
  .strict();

const medicationChangeSchema = z
  .object({
    drug_name: text(),
    drug_code: nullableText(200),
    change_type: z.enum([
      'added',
      'removed',
      'dose_changed',
      'frequency_changed',
      'days_changed',
      'unchanged',
    ]),
    previous: nullableText(2_000),
    current: text(2_000),
    prescribed_date: temporal.nullable(),
    prescriber_name: nullableText(),
  })
  .strict();

const patientChangeSchema = z
  .object({
    category: z.enum([
      'primary_condition',
      'medical_procedure',
      'narcotic',
      'care_level',
      'care_team',
      'contact',
      'residence',
      'insurance',
    ]),
    field_label: text(),
    previous: nullableText(4_000),
    current: nullableText(4_000),
    change_type: z.enum(['added', 'removed', 'changed']),
  })
  .strict();

const medicationSchema = z
  .object({
    drug_name: text(),
    dose: text(),
    frequency: text(),
    dosage_form: nullableText(),
    route: nullableText(),
    prescriber_name: nullableText(),
    start_date: temporal.nullable(),
    end_date: temporal.nullable(),
    source: nullableText(),
    drug_price: z.number().nonnegative().finite().nullable(),
    is_generic: z.boolean().nullable(),
    is_narcotic: z.boolean().nullable(),
    is_psychotropic: z.boolean().nullable(),
    therapeutic_category: nullableText(),
  })
  .strict()
  .superRefine((medication, context) => {
    if (
      medication.start_date &&
      medication.end_date &&
      Date.parse(medication.end_date) < Date.parse(medication.start_date)
    )
      context.addIssue({ code: 'custom', message: 'Medication end date predates start date' });
  });

const dispensingItemSchema = z
  .object({
    drug_name: text(),
    dispensing_method: nullableText(),
    packaging_instructions: nullableText(4_000),
    set_method: nullableText(),
    set_period_label: nullableText(),
    audit_status: nullableText(),
    outside_med_kind: z.enum(['prn', 'topical', 'cold', 'injection', 'liquid', 'other']).nullable(),
    outside_med_label: nullableText(),
    note: z.string().max(4_000),
  })
  .strict()
  .superRefine((item, context) => {
    if ((item.outside_med_kind === null) !== (item.outside_med_label === null))
      context.addIssue({ code: 'custom', message: 'Outside medication label drift' });
  });

const deliveryItemSchema = z
  .object({
    title: text(),
    status_bucket: z.enum(['unconfirmed', 'reply_waiting', 'failed', 'shared']),
    summary: text(4_000),
    occurred_at: temporal.nullable(),
    action_href: internalHref,
  })
  .strict();

const dosageFormCandidateSchema = z
  .object({
    drug_name: nullableText(),
    category: z.enum(['unit_dose', 'crush', 'form_change']),
    reason: text(4_000),
    caution: nullableText(4_000),
  })
  .strict();

const communicationItemSchema = z
  .object({
    source_type: z.enum([
      'self_report',
      'communication',
      'request',
      'contact_log',
      'care_team',
      'inbound_communication',
    ]),
    title: text(),
    summary: text(4_000),
    occurred_at: temporal.nullable(),
    counterpart: nullableText(),
    severity: z.enum(['urgent', 'high', 'normal', 'low']),
    action_href: internalHref.optional(),
    action_label: text().optional(),
  })
  .strict()
  .superRefine((item, context) => {
    if ((item.action_href === undefined) !== (item.action_label === undefined))
      context.addIssue({ code: 'custom', message: 'Communication action drift' });
  });

const jahisRecordSchema = z
  .object({
    id: text(200),
    record_type: text(200),
    record_label: text(),
    summary: nullableText(4_000),
    details: z.array(z.object({ label: text(), value: text(4_000) }).strict()).max(100),
    raw_line: z.string().max(10_000),
    created_at: dateTime,
  })
  .strict();

const labSchema = z
  .object({
    analyte_code: text(200),
    analyte_label: text(),
    value_numeric: z.number().finite().nullable(),
    unit: nullableText(200),
    value_label: text(),
    measured_at: temporal,
    measured_at_label: text(),
    stale: z.boolean(),
    abnormal: z.boolean(),
    abnormal_flag: nullableText(100),
  })
  .strict();

const unresolvedItemSchema = z
  .object({
    source_type: z.enum([
      'task',
      'issue',
      'inquiry',
      'billing',
      'medication_stock',
      'inbound_communication_signal',
    ]),
    title: text(),
    summary: text(4_000),
    severity: z.enum(['urgent', 'high', 'normal', 'low']),
    href: internalHref,
  })
  .strict();

const ruleSummarySchema = z
  .object({
    generation_id: text(200),
    headline: text(4_000),
    bullets: boundedStrings(30, 4_000),
    must_check_today: boundedStrings(50, 4_000),
    source_refs: boundedStrings(100, 500),
    generated_at: dateTime,
  })
  .strict();

const aiSummarySchema = z
  .object({
    generation_id: text(200),
    provider: z.enum(['rule', 'openai']),
    requested_provider: text(200),
    is_fallback: z.boolean(),
    model: nullableText(200),
    fallback_reason: nullableText(1_000),
    headline: text(4_000),
    bullets: boundedStrings(30, 4_000),
    must_check_today: boundedStrings(50, 4_000),
    source_refs: boundedStrings(100, 500),
    generated_at: dateTime,
    duration_ms: z.number().int().nonnegative().nullable(),
    recent_generation_count_24h: count,
    recent_failure_count_24h: count,
    recent_failure_rate_24h: z.number().min(0).max(100).finite().nullable(),
  })
  .strict()
  .superRefine((summary, context) => {
    const expectedFailureRate =
      summary.recent_generation_count_24h > 0
        ? Math.round(
            (summary.recent_failure_count_24h / summary.recent_generation_count_24h) * 1_000,
          ) / 10
        : null;
    if (
      summary.recent_failure_count_24h > summary.recent_generation_count_24h ||
      (summary.recent_generation_count_24h === 0) !== (summary.recent_failure_rate_24h === null) ||
      summary.recent_failure_rate_24h !== expectedFailureRate ||
      (summary.provider === 'openai' && summary.is_fallback) ||
      summary.is_fallback !== (summary.fallback_reason !== null)
    )
      context.addIssue({ code: 'custom', message: 'AI summary state or aggregate drift' });
  });

const conferenceSummarySchema = z
  .object({
    recent_conferences: count,
    pending_action_items: count,
    last_conference_date: temporal.nullable(),
    last_conference_type: nullableText(),
    summary: nullableText(8_000),
    highlighted_risks: boundedStrings(30, 2_000),
  })
  .strict()
  .superRefine((summary, context) => {
    if (
      (summary.recent_conferences === 0) !== (summary.last_conference_date === null) ||
      (summary.last_conference_date === null) !== (summary.last_conference_type === null)
    )
      context.addIssue({ code: 'custom', message: 'Conference summary aggregate drift' });
  });

const facilityContextSchema = z
  .object({
    acceptance_time_from: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .nullable(),
    acceptance_time_to: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .nullable(),
    notes: nullableText(4_000),
  })
  .strict();

const drugCautionSchema = z
  .object({
    drug_name: text(),
    drug_code: text(200),
    caution_type: z.enum([
      'contraindication',
      'adverse_effect',
      'elderly_precaution',
      'interaction',
    ]),
    severity: z.enum(['critical', 'warning', 'info']),
    summary: text(4_000),
  })
  .strict();

export function buildPatientVisitBriefResponseSchema(patientId: string) {
  return z
    .object({
      data: z
        .object({
          patient: z
            .object({
              id: z.literal(patientId),
              name: text(),
              archive: archiveSchema,
            })
            .strict(),
          context: z.literal('patient'),
          generated_at: dateTime,
          last_prescribed_date: temporal.nullable(),
          baseline_context: baselineContextSchema.nullable(),
          medication_changes: z.array(medicationChangeSchema).max(8),
          patient_changes: z.array(patientChangeSchema).max(100),
          medications: z.array(medicationSchema).max(500),
          dispensing_items: z.array(dispensingItemSchema).max(500),
          delivery_status: z.array(deliveryItemSchema).max(100),
          dosage_form_support: z.array(dosageFormCandidateSchema).max(100),
          multidisciplinary_updates: z.array(communicationItemSchema).max(200),
          jahis_supplemental_records: z.array(jahisRecordSchema).max(100),
          latest_labs: z.array(labSchema).max(100),
          unresolved_items: z.array(unresolvedItemSchema).max(200),
          must_check_today: boundedStrings(100, 4_000),
          rule_summary: ruleSummarySchema,
          ai_summary: aiSummarySchema,
          conference_summary: conferenceSummarySchema.nullable(),
          facility_context: facilityContextSchema.nullable(),
          drug_cautions: z.array(drugCautionSchema).max(200),
        })
        .strict(),
    })
    .strict()
    .superRefine(({ data }, context) => {
      const uniqueBy = <T>(items: T[], key: (item: T) => string) =>
        new Set(items.map(key)).size === items.length;
      if (
        !uniqueBy(data.jahis_supplemental_records, (item) => item.id) ||
        !uniqueBy(data.latest_labs, (item) => item.analyte_code) ||
        !uniqueBy(data.drug_cautions, (item) => `${item.drug_code}:${item.caution_type}`) ||
        new Set(data.must_check_today).size !== data.must_check_today.length
      )
        context.addIssue({ code: 'custom', path: ['data'], message: 'Visit brief identity drift' });
    })
    .transform(({ data }): { data: VisitBrief } => ({ data }));
}
