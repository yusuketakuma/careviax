import { z } from 'zod';

export const upsertVisitPreparationSchema = z.object({
  checklist: z.record(z.string(), z.unknown()).default({}),
  medication_changes_reviewed: z.boolean().default(false),
  carry_items_confirmed: z.boolean().default(false),
  previous_issues_reviewed: z.boolean().default(false),
  route_confirmed: z.boolean().default(false),
  offline_synced: z.boolean().default(false),
});
