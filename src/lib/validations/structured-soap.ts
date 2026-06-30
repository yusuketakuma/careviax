import { z } from 'zod';
import { dateKeySchema } from './date-key';

const numberFieldSchema = z.number().finite();
const optionalStringArraySchema = z.array(z.string());

const vitalSignsSchema = z
  .object({
    systolic_bp: numberFieldSchema.optional(),
    diastolic_bp: numberFieldSchema.optional(),
    pulse: numberFieldSchema.optional(),
    temperature: numberFieldSchema.optional(),
    spo2: numberFieldSchema.optional(),
    weight: numberFieldSchema.optional(),
  })
  .passthrough();

const labValuesSchema = z
  .object({
    wbc: numberFieldSchema.optional(),
    neut: numberFieldSchema.optional(),
    hb: numberFieldSchema.optional(),
    plt: numberFieldSchema.optional(),
    pt_inr: numberFieldSchema.optional(),
    ast: numberFieldSchema.optional(),
    alt: numberFieldSchema.optional(),
    t_bil: numberFieldSchema.optional(),
    scr: numberFieldSchema.optional(),
    egfr: numberFieldSchema.optional(),
    bun: numberFieldSchema.optional(),
    ck: numberFieldSchema.optional(),
    bnp: numberFieldSchema.optional(),
    nt_pro_bnp: numberFieldSchema.optional(),
    na: numberFieldSchema.optional(),
    k: numberFieldSchema.optional(),
    cl: numberFieldSchema.optional(),
    hba1c: numberFieldSchema.optional(),
    blood_glucose: numberFieldSchema.optional(),
    alb: numberFieldSchema.optional(),
    tp: numberFieldSchema.optional(),
    crp: numberFieldSchema.optional(),
    free_text: z.string().optional(),
  })
  .passthrough();

const functionalAssessmentSchema = z
  .object({
    sleep: optionalStringArraySchema.optional(),
    cognition: optionalStringArraySchema.optional(),
    diet_oral: optionalStringArraySchema.optional(),
    mobility: optionalStringArraySchema.optional(),
    excretion: optionalStringArraySchema.optional(),
  })
  .passthrough();

const adverseEventsSchema = z
  .object({
    has_events: z.boolean().optional(),
    events: optionalStringArraySchema.optional(),
    details: z.string().optional(),
  })
  .passthrough();

const subjectiveSchema = z
  .object({
    symptom_checks: optionalStringArraySchema.optional(),
    free_text: z.string().optional(),
  })
  .passthrough();

const objectiveSchema = z
  .object({
    vitals: vitalSignsSchema.optional(),
    lab_values: labValuesSchema.optional(),
    medication_status: z.string().optional(),
    adherence_score: z
      .union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)])
      .optional(),
    self_management_ability: z.string().optional(),
    medication_calendar_used: z.boolean().optional(),
    side_effect_checks: optionalStringArraySchema.optional(),
    functional_assessment: functionalAssessmentSchema.optional(),
    adverse_events: adverseEventsSchema.optional(),
    free_text: z.string().optional(),
  })
  .passthrough();

const assessmentSchema = z
  .object({
    problem_checks: optionalStringArraySchema.optional(),
    severity: z.string().optional(),
    drug_related_problems: optionalStringArraySchema.optional(),
    free_text: z.string().optional(),
  })
  .passthrough();

const planSchema = z
  .object({
    intervention_checks: optionalStringArraySchema.optional(),
    next_visit_date: dateKeySchema('次回訪問日の形式が不正です（YYYY-MM-DD）').optional(),
    prescription_proposal: z.string().optional(),
    physician_report_items: z.string().optional(),
    care_manager_report_items: z.string().optional(),
    care_service_coordination: z.string().optional(),
    free_text: z.string().optional(),
  })
  .passthrough();

const residualMedicationSchema = z
  .object({
    drug_master_id: z.string().trim().nullable().optional(),
    drug_code: z.string().trim().nullable().optional(),
    drug_name: z.string(),
    remaining_quantity: numberFieldSchema,
    excess_days: numberFieldSchema,
    is_reduction_target: z.boolean(),
  })
  .passthrough();

const handoffSchema = z
  .object({
    next_check_items: optionalStringArraySchema.optional(),
    ongoing_monitoring: optionalStringArraySchema.optional(),
    decision_rationale: z.string().nullable().optional(),
    ai_extracted: z.boolean().optional(),
    ai_confidence: numberFieldSchema.nullable().optional(),
    confirmed_by: z.string().nullable().optional(),
    confirmed_at: z.string().nullable().optional(),
    extracted_at: z.string().nullable().optional(),
  })
  .passthrough();

const homeVisit2026EvidenceSchema = z
  .object({
    medication_review_completed: z.boolean().optional(),
    residual_medication_checked: z.boolean().optional(),
    adverse_event_checked: z.boolean().optional(),
    polypharmacy_reviewed: z.boolean().optional(),
    after_hours_contact_confirmed: z.boolean().optional(),
  })
  .passthrough();

const previousVisitReuseSchema = z
  .object({
    source_visit_record_id: z.string().optional(),
    source_visit_record_version: z.number().int().nullable().optional(),
    source_visit_record_updated_at: z.string().nullable().optional(),
    carry_forward_items: optionalStringArraySchema.optional(),
  })
  .passthrough();

export const structuredSoapInputSchema = z
  .object({
    subjective: subjectiveSchema.optional(),
    objective: objectiveSchema.optional(),
    assessment: assessmentSchema.optional(),
    plan: planSchema.optional(),
    residual_medications: z.array(residualMedicationSchema).optional(),
    home_visit_2026: homeVisit2026EvidenceSchema.optional(),
    handoff: handoffSchema.nullable().optional(),
    previous_visit_reuse: previousVisitReuseSchema.optional(),
  })
  .passthrough();
