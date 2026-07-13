import { z } from 'zod';
import { allergyEntrySchema } from '@/lib/validations/patient-allergy';

const idSchema = z.string().trim().min(1).max(255);
const textSchema = z.string().max(10_000);
const nullableTextSchema = textSchema.nullable();
const countSchema = z.number().int().nonnegative();
const dateSchema = z.union([z.string().date(), z.string().datetime({ offset: true })]);
const nullableDateSchema = dateSchema.nullable();
const internalHrefSchema = z
  .string()
  .startsWith('/')
  .refine((href) => !href.startsWith('//'))
  .refine((href) => !/(?:token|storage_?key|x-amz-|signature)=/i.test(href));

const archiveSchema = z
  .object({
    status: z.enum(['active', 'archived']),
    archived: z.boolean(),
    archived_at: nullableDateSchema,
  })
  .strict()
  .superRefine((archive, context) => {
    if (
      archive.archived !== Boolean(archive.archived_at) ||
      archive.status !== (archive.archived ? 'archived' : 'active')
    ) {
      context.addIssue({ code: 'custom', message: 'archive state mismatch' });
    }
  });

const visitBriefSchema = z
  .object({
    patient: z
      .object({
        id: idSchema,
        name: z.string().trim().min(1).max(500),
        archive: archiveSchema.nullable().optional(),
      })
      .strict(),
    context: z.enum(['patient', 'schedule']),
    generated_at: dateSchema,
    last_prescribed_date: nullableDateSchema,
    baseline_context: z
      .object({
        care_level: nullableTextSchema,
        adl_level: nullableTextSchema,
        dementia_level: nullableTextSchema,
        medication_support_methods: z.array(textSchema),
        special_medical_procedures: z.array(textSchema),
        family_key_person: nullableTextSchema,
        money_management: nullableTextSchema,
        visit_before_contact_required: z.boolean().nullable(),
        narcotics_base: z.boolean().nullable(),
        narcotics_rescue: z.boolean().nullable(),
        infection_isolation: nullableTextSchema,
      })
      .strict()
      .nullable(),
    medication_changes: z.array(
      z
        .object({
          drug_name: textSchema,
          drug_code: nullableTextSchema,
          change_type: z.enum([
            'added',
            'removed',
            'dose_changed',
            'frequency_changed',
            'days_changed',
            'unchanged',
          ]),
          previous: nullableTextSchema,
          current: textSchema,
          prescribed_date: nullableDateSchema,
          prescriber_name: nullableTextSchema,
        })
        .strict(),
    ),
    patient_changes: z.array(
      z
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
          field_label: textSchema,
          previous: nullableTextSchema,
          current: nullableTextSchema,
          change_type: z.enum(['added', 'removed', 'changed']),
        })
        .strict(),
    ),
    medications: z.array(
      z
        .object({
          drug_name: textSchema,
          dose: textSchema,
          frequency: textSchema,
          dosage_form: nullableTextSchema,
          route: nullableTextSchema,
          prescriber_name: nullableTextSchema,
          start_date: nullableDateSchema,
          end_date: nullableDateSchema,
          source: nullableTextSchema,
          drug_price: z.number().finite().nonnegative().nullable(),
          is_generic: z.boolean().nullable(),
          is_narcotic: z.boolean().nullable(),
          is_psychotropic: z.boolean().nullable(),
          therapeutic_category: nullableTextSchema,
        })
        .strict(),
    ),
    dispensing_items: z.array(
      z
        .object({
          drug_name: textSchema,
          dispensing_method: nullableTextSchema,
          packaging_instructions: nullableTextSchema,
          set_method: nullableTextSchema,
          set_period_label: nullableTextSchema,
          audit_status: nullableTextSchema,
          outside_med_kind: z
            .enum(['prn', 'topical', 'cold', 'injection', 'liquid', 'other'])
            .nullable(),
          outside_med_label: nullableTextSchema,
          note: textSchema,
        })
        .strict(),
    ),
    delivery_status: z.array(
      z
        .object({
          title: textSchema,
          status_bucket: z.enum(['unconfirmed', 'reply_waiting', 'failed', 'shared']),
          summary: textSchema,
          occurred_at: nullableDateSchema,
          action_href: internalHrefSchema,
        })
        .strict(),
    ),
    dosage_form_support: z.array(
      z
        .object({
          drug_name: nullableTextSchema,
          category: z.enum(['unit_dose', 'crush', 'form_change']),
          reason: textSchema,
          caution: nullableTextSchema,
        })
        .strict(),
    ),
    multidisciplinary_updates: z.array(
      z
        .object({
          source_type: z.enum([
            'self_report',
            'communication',
            'request',
            'contact_log',
            'care_team',
            'inbound_communication',
          ]),
          title: textSchema,
          summary: textSchema,
          occurred_at: nullableDateSchema,
          counterpart: nullableTextSchema,
          severity: z.enum(['urgent', 'high', 'normal', 'low']),
          action_href: internalHrefSchema.optional(),
          action_label: textSchema.optional(),
        })
        .strict(),
    ),
    jahis_supplemental_records: z.array(
      z
        .object({
          id: idSchema,
          record_type: idSchema,
          record_label: textSchema,
          summary: nullableTextSchema,
          details: z.array(z.object({ label: textSchema, value: textSchema }).strict()),
          raw_line: textSchema,
          created_at: dateSchema,
        })
        .strict(),
    ),
    latest_labs: z.array(
      z
        .object({
          analyte_code: idSchema,
          analyte_label: textSchema,
          value_numeric: z.number().finite().nullable(),
          unit: nullableTextSchema,
          value_label: textSchema,
          measured_at: dateSchema,
          measured_at_label: textSchema,
          stale: z.boolean(),
          abnormal: z.boolean(),
          abnormal_flag: nullableTextSchema,
        })
        .strict(),
    ),
    unresolved_items: z.array(
      z
        .object({
          source_type: z.enum([
            'task',
            'issue',
            'inquiry',
            'billing',
            'medication_stock',
            'inbound_communication_signal',
          ]),
          title: textSchema,
          summary: textSchema,
          severity: z.enum(['urgent', 'high', 'normal', 'low']),
          href: internalHrefSchema,
        })
        .strict(),
    ),
    must_check_today: z.array(textSchema),
    rule_summary: z
      .object({
        generation_id: idSchema,
        headline: textSchema,
        bullets: z.array(textSchema),
        must_check_today: z.array(textSchema),
        source_refs: z.array(textSchema),
        generated_at: dateSchema,
      })
      .strict(),
    ai_summary: z
      .object({
        generation_id: idSchema,
        provider: z.enum(['rule', 'openai']),
        requested_provider: textSchema,
        is_fallback: z.boolean(),
        model: nullableTextSchema,
        fallback_reason: nullableTextSchema,
        headline: textSchema,
        bullets: z.array(textSchema),
        must_check_today: z.array(textSchema),
        source_refs: z.array(textSchema),
        generated_at: dateSchema,
        duration_ms: z.number().finite().nonnegative().nullable(),
        recent_generation_count_24h: countSchema,
        recent_failure_count_24h: countSchema,
        recent_failure_rate_24h: z.number().finite().min(0).max(1).nullable(),
      })
      .strict(),
    conference_summary: z
      .object({
        recent_conferences: countSchema,
        pending_action_items: countSchema,
        last_conference_date: nullableDateSchema,
        last_conference_type: nullableTextSchema,
        summary: nullableTextSchema,
        highlighted_risks: z.array(textSchema),
      })
      .strict()
      .nullable(),
    facility_context: z
      .object({
        acceptance_time_from: nullableTextSchema,
        acceptance_time_to: nullableTextSchema,
        notes: nullableTextSchema,
      })
      .strict()
      .nullable(),
    drug_cautions: z.array(
      z
        .object({
          drug_name: textSchema,
          drug_code: idSchema,
          caution_type: z.enum([
            'contraindication',
            'adverse_effect',
            'elderly_precaution',
            'interaction',
          ]),
          severity: z.enum(['critical', 'warning', 'info']),
          summary: textSchema,
        })
        .strict(),
    ),
  })
  .strict();

const workspaceSchema = z
  .object({
    cycle_id: idSchema,
    overall_status: idSchema,
    exception_status: nullableTextSchema,
    action_context: z
      .object({
        patient_id: idSchema,
        prescription_intake_id: idSchema.nullable(),
        visit_schedule_id: idSchema.nullable(),
        visit_record_id: idSchema.nullable(),
        report_id: idSchema.nullable(),
      })
      .strict(),
    current_intake: z
      .object({ id: idSchema, prescribed_date: dateSchema, prescription_category: idSchema })
      .strict()
      .nullable(),
    safety: z
      .object({
        allergy: nullableTextSchema,
        renal: nullableTextSchema,
        handling_tags: z.array(textSchema),
        swallowing: nullableTextSchema,
        cautions: z.array(textSchema),
      })
      .strict(),
    prescription_lines: z.array(
      z
        .object({
          id: idSchema,
          drug_name: textSchema,
          dose: textSchema,
          frequency: textSchema,
          days: countSchema,
          quantity: z.number().finite().nonnegative().nullable(),
          unit: nullableTextSchema,
          packaging_instruction_tags: z.array(textSchema),
        })
        .strict(),
    ),
    recent_activities: z.array(
      z
        .object({
          id: idSchema,
          type: z.enum(['transition', 'inquiry', 'intake']),
          label: textSchema,
          actor: nullableTextSchema,
          at: dateSchema,
          href: internalHrefSchema,
        })
        .strict(),
    ),
    today_tasks: z.array(
      z
        .object({
          id: idSchema,
          tone: z.enum(['deadline', 'waiting', 'scheduled']),
          time_label: textSchema,
          label: textSchema,
          href: internalHrefSchema,
          action_label: textSchema,
          due_time: nullableTextSchema,
        })
        .strict(),
    ),
    open_exceptions: z.array(
      z
        .object({
          id: idSchema,
          exception_type: idSchema,
          description: textSchema,
          severity: z.enum(['critical', 'warning']),
          created_at: nullableDateSchema,
        })
        .strict(),
    ),
    medication_changes: z.array(
      z
        .object({
          change_type: z.enum([
            'added',
            'removed',
            'dose_changed',
            'frequency_changed',
            'days_changed',
          ]),
          drug_name: textSchema,
          drug_code: nullableTextSchema,
          frequency: nullableTextSchema,
          days: countSchema.nullable(),
        })
        .strict(),
    ),
    previous_medication: z
      .object({ start: nullableDateSchema, end: nullableDateSchema })
      .strict()
      .nullable(),
    current_medication: z
      .object({ start: nullableDateSchema, end: nullableDateSchema })
      .strict()
      .nullable(),
    set_plan: z
      .object({
        id: idSchema,
        set_method: idSchema,
        notes: nullableTextSchema,
        target_period_start: dateSchema,
        target_period_end: dateSchema,
        processing: z
          .object({ unit_dose: z.boolean(), separate_pack: z.boolean(), crushed: z.boolean() })
          .strict(),
      })
      .strict()
      .nullable(),
    prescription_document_url: nullableTextSchema,
  })
  .strict();

export function buildPatientOverviewResponseSchema(expectedPatientId: string) {
  return z
    .object({
      data: z
        .object({
          id: z.literal(expectedPatientId),
          name: z.string().trim().min(1).max(500),
          name_kana: z.string().max(500),
          birth_date: dateSchema,
          gender: idSchema,
          phone: nullableTextSchema,
          medical_insurance_number: nullableTextSchema,
          care_insurance_number: nullableTextSchema,
          billing_support_flag: z.boolean(),
          primary_pharmacist_id: idSchema.nullable(),
          backup_pharmacist_id: idSchema.nullable(),
          primary_staff_id: idSchema.nullable(),
          backup_staff_id: idSchema.nullable(),
          allergy_info: z.array(allergyEntrySchema.strict()).nullable(),
          notes: nullableTextSchema,
          archived_at: nullableDateSchema,
          archived_by: idSchema.nullable(),
          archived_by_name: nullableTextSchema,
          updated_at: dateSchema,
          residences: z.array(
            z
              .object({
                id: idSchema,
                address: textSchema,
                building_id: idSchema.nullable(),
                facility_id: idSchema.nullable(),
                facility_unit_id: idSchema.nullable(),
                unit_name: nullableTextSchema,
                is_primary: z.boolean(),
              })
              .strict(),
          ),
          scheduling_preference: z
            .object({
              preferred_weekdays: z.array(z.number().int().min(0).max(6)).nullable(),
              preferred_time_from: nullableTextSchema,
              preferred_time_to: nullableTextSchema,
              phone_contact_from: nullableTextSchema,
              phone_contact_to: nullableTextSchema,
              facility_time_from: nullableTextSchema,
              facility_time_to: nullableTextSchema,
              family_presence_required: z.boolean().nullable(),
              visit_buffer_minutes: countSchema.nullable(),
              preferred_contact_name: nullableTextSchema,
              preferred_contact_phone: nullableTextSchema,
              visit_before_contact_required: z.boolean().nullable(),
              first_visit_preferred_date: nullableDateSchema,
              first_visit_time_slot: nullableTextSchema,
              first_visit_time_note: nullableTextSchema,
              parking_available: z.boolean().nullable(),
              primary_contact_preference: nullableTextSchema,
              mcs_linked: z.boolean().nullable(),
              adl_level: nullableTextSchema,
              dementia_level: nullableTextSchema,
              swallowing_route: nullableTextSchema,
              care_level: nullableTextSchema,
              infection_isolation: z.boolean(),
            })
            .strict()
            .nullable(),
          conditions: z.array(
            z
              .object({
                id: idSchema,
                condition_type: z.enum(['disease', 'problem']),
                name: textSchema,
                is_primary: z.boolean(),
                is_active: z.boolean(),
                noted_at: nullableDateSchema,
                notes: nullableTextSchema,
              })
              .strict(),
          ),
          contacts: z.array(
            z
              .object({
                id: idSchema,
                relation: z.enum([
                  'self',
                  'spouse',
                  'child',
                  'parent',
                  'sibling',
                  'care_manager',
                  'physician',
                  'nurse',
                  'facility_staff',
                  'other',
                ]),
                name: textSchema,
                phone: nullableTextSchema,
                email: nullableTextSchema,
                fax: nullableTextSchema,
                organization_name: nullableTextSchema,
                department: nullableTextSchema,
                address: nullableTextSchema,
                is_primary: z.boolean(),
                is_emergency_contact: z.boolean(),
                notes: nullableTextSchema,
              })
              .strict(),
          ),
          cases: z.array(
            z
              .object({
                id: idSchema,
                display_id: nullableTextSchema.optional(),
                status: idSchema,
                primary_pharmacist_id: idSchema.nullable(),
                backup_pharmacist_id: idSchema.nullable(),
                referral_source: nullableTextSchema,
                referral_date: nullableDateSchema,
                start_date: nullableDateSchema,
                end_date: nullableDateSchema,
                end_reason: nullableTextSchema,
                notes: nullableTextSchema,
                created_at: dateSchema,
                updated_at: dateSchema,
                required_visit_support: z.record(z.string(), z.unknown()).nullable(),
                care_team_links: z.array(
                  z
                    .object({
                      id: idSchema,
                      external_professional_id: idSchema.nullable().optional(),
                      role: textSchema,
                      name: textSchema,
                      organization_name: nullableTextSchema,
                      department: nullableTextSchema,
                      phone: nullableTextSchema,
                      email: nullableTextSchema,
                      fax: nullableTextSchema,
                      address: nullableTextSchema,
                      is_primary: z.boolean(),
                      notes: nullableTextSchema,
                    })
                    .strict(),
                ),
              })
              .strict(),
          ),
          visit_schedules: z.array(
            z
              .object({
                id: idSchema,
                scheduled_date: dateSchema,
                schedule_status: idSchema,
                time_window_start: nullableTextSchema,
                confirmed_at: nullableDateSchema,
                visit_record: z
                  .object({ id: idSchema, outcome_status: idSchema })
                  .strict()
                  .nullable(),
              })
              .strict(),
          ),
          summary_metrics: z.object({ open_tasks_count: countSchema }).strict(),
          risk_summary: z
            .object({
              patient_id: z.literal(expectedPatientId),
              patient_name: textSchema,
              score: z.number().finite().nonnegative(),
              level: z.enum(['stable', 'watch', 'high']),
              reasons: z.array(textSchema),
              unresolved_self_reports: countSchema,
              open_issues: countSchema,
              disrupted_visits_30d: countSchema,
              pending_reports: countSchema,
              open_tasks: countSchema,
              missing_visit_consent: z.boolean(),
              missing_management_plan: z.boolean(),
            })
            .strict()
            .nullable(),
          visit_brief: visitBriefSchema,
          lab_summary: z.array(
            z
              .object({
                analyte_code: idSchema,
                value_numeric: z.number().finite().nullable(),
                measured_at: dateSchema,
                unit: nullableTextSchema,
                abnormal_flag: nullableTextSchema,
              })
              .strict(),
          ),
          foundation: z
            .object({
              summary: z
                .object({
                  status: z.enum(['ready', 'needs_confirmation', 'missing']),
                  label: textSchema,
                  items: z.array(textSchema),
                })
                .strict(),
              items: z.array(
                z
                  .object({
                    key: idSchema,
                    label: textSchema,
                    status: z.enum(['ready', 'needs_confirmation', 'missing']),
                    detail: textSchema,
                    action_href: internalHrefSchema,
                    action_label: textSchema,
                    meta: z
                      .object({
                        updated_at: dateSchema,
                        updated_by_name: nullableTextSchema,
                        source: textSchema,
                        confirmed_at: nullableDateSchema,
                        confirmed_by_name: nullableTextSchema,
                        confirmation_status: z.enum(['confirmed', 'unconfirmed', 'stale']),
                        confirmation_detail: textSchema,
                        stale: z.boolean(),
                      })
                      .strict()
                      .nullable()
                      .optional(),
                  })
                  .strict(),
              ),
              changes_since_last_visit: z.array(
                z
                  .object({
                    id: idSchema,
                    category: idSchema,
                    field_label: nullableTextSchema,
                    field_key: idSchema,
                    source: textSchema,
                    updated_by_name: nullableTextSchema,
                    created_at: dateSchema,
                  })
                  .strict(),
              ),
              latest_labs: z.array(
                z
                  .object({
                    analyte_code: idSchema,
                    value_label: textSchema,
                    measured_at: dateSchema,
                    stale: z.boolean(),
                    abnormal: z.boolean(),
                  })
                  .strict(),
              ),
              insurances: z.array(
                z
                  .object({
                    insurance_type: idSchema,
                    status_label: textSchema,
                    period_label: textSchema,
                    copay_label: nullableTextSchema,
                    expires_soon: z.boolean(),
                  })
                  .strict(),
              ),
              archive: z
                .object({
                  archived: z.boolean(),
                  archived_at: nullableDateSchema,
                  archived_by_name: nullableTextSchema,
                })
                .strict(),
            })
            .strict(),
          jahis_supplemental_records: z.array(
            z
              .object({
                id: idSchema,
                record_type: idSchema,
                record_label: textSchema,
                line_number: z.number().int().positive(),
                summary: nullableTextSchema,
                payload: z.unknown().optional(),
                raw_line: textSchema.optional(),
              })
              .strict(),
          ),
          workspace: workspaceSchema.nullable(),
          privacy: z
            .object({
              sensitive_fields_masked: z.boolean(),
              address_fields_masked: z.boolean(),
              can_view_detail: z.boolean(),
            })
            .strict(),
        })
        .strict(),
    })
    .strict()
    .superRefine(({ data }, context) => {
      if (
        data.visit_brief.patient.id !== expectedPatientId ||
        (data.workspace != null && data.workspace.action_context.patient_id !== expectedPatientId)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['data'],
          message: 'patient overview identity mismatch',
        });
      }
      for (const [path, values] of [
        ['residences', data.residences.map((item) => item.id)],
        ['conditions', data.conditions.map((item) => item.id)],
        ['contacts', data.contacts.map((item) => item.id)],
        ['cases', data.cases.map((item) => item.id)],
        ['visit_schedules', data.visit_schedules.map((item) => item.id)],
      ] as const) {
        if (new Set(values).size !== values.length) {
          context.addIssue({ code: 'custom', path: ['data', path], message: 'duplicate identity' });
        }
      }
    });
}
