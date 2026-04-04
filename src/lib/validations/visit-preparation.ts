import { z } from 'zod';

export const upsertVisitPreparationSchema = z.object({
  checklist: z.record(z.string(), z.unknown()).default({}),
  medication_changes_reviewed: z.boolean().default(false),
  carry_items_confirmed: z.boolean().default(false),
  previous_issues_reviewed: z.boolean().default(false),
  route_confirmed: z.boolean().default(false),
  offline_synced: z.boolean().default(false),
  /** テンプレートオプション — 指定時はチェックリストをテンプレートから初期化する */
  template_options: z
    .object({
      narcotics_carry: z.boolean().optional(),
      infection_control: z.boolean().optional(),
      cold_chain_required: z.boolean().optional(),
      facility_custom_items: z.array(z.string()).optional(),
    })
    .optional(),
});

export type UpsertVisitPreparationInput = z.infer<typeof upsertVisitPreparationSchema>;
