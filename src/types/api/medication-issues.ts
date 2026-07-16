import { z } from 'zod';
import { apiCursorPageSchema } from '@/lib/api/response-schemas';

export const medicationIssueListItemSchema = z
  .object({
    id: z.string(),
    org_id: z.string(),
    patient_id: z.string(),
    case_id: z.string().nullable(),
    title: z.string(),
    description: z.string(),
    status: z.enum(['open', 'in_progress', 'resolved', 'dismissed']),
    priority: z.enum(['critical', 'high', 'medium', 'low']),
    category: z.enum(['adherence', 'side_effect', 'interaction', 'duplicate', 'other']).nullable(),
    identified_by: z.string(),
    identified_at: z.string(),
    resolved_by: z.string().nullable(),
    resolved_at: z.string().nullable(),
    version: z.number().int().positive(),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .strict();

export const medicationIssuesCursorResponseSchema = apiCursorPageSchema(
  medicationIssueListItemSchema,
);

export type MedicationIssueListItem = z.infer<typeof medicationIssueListItemSchema>;
