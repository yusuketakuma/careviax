import { z } from 'zod';
import type { CaseStatus } from '@prisma/client';

export const CASE_STATUSES = [
  'referral_received',
  'assessment',
  'active',
  'on_hold',
  'discharged',
  'terminated',
] as const satisfies readonly [CaseStatus, ...CaseStatus[]];

export const caseStatusSchema = z.enum(CASE_STATUSES);

export function parseCaseStatusList(value: string | undefined): CaseStatus[] {
  if (!value) return [];
  return value
    .split(',')
    .map((status) => status.trim())
    .filter(Boolean)
    .map((status) => caseStatusSchema.parse(status));
}
