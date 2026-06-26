import { z } from 'zod';
import { CASE_STATUSES } from '@/lib/patient/case-status';

export const caseStatusValues = CASE_STATUSES;
export type CaseStatus = (typeof caseStatusValues)[number];

/** Allowed state transitions */
export const caseStatusTransitions: Record<CaseStatus, CaseStatus[]> = {
  referral_received: ['assessment', 'terminated'],
  assessment: ['active', 'on_hold', 'terminated'],
  active: ['on_hold', 'discharged', 'terminated'],
  on_hold: ['active', 'terminated'],
  discharged: [],
  terminated: [],
};

export const createCaseSchema = z.object({
  patient_id: z.string().min(1, '患者IDは必須です'),
  referral_source: z.string().optional(),
  referral_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, '日付形式が不正です')
    .optional()
    .or(z.literal(''))
    .transform((v) => (v === '' ? undefined : v)),
  notes: z.string().optional(),
});

export const updateCaseSchema = z.object({
  referral_source: z.string().optional(),
  notes: z.string().optional(),
  primary_pharmacist_id: z.string().optional(),
  backup_pharmacist_id: z.string().optional(),
  primary_staff_id: z.string().optional(),
  backup_staff_id: z.string().optional(),
  start_date: z.string().optional(),
  end_date: z.string().optional(),
  end_reason: z.string().optional(),
  required_visit_support: z.record(z.string(), z.unknown()).optional(),
});

export const caseTransitionSchema = z.object({
  from: z.enum(caseStatusValues),
  to: z.enum(caseStatusValues),
});

export type CreateCaseInput = z.infer<typeof createCaseSchema>;
export type UpdateCaseInput = z.infer<typeof updateCaseSchema>;
export type CaseTransitionInput = z.infer<typeof caseTransitionSchema>;
