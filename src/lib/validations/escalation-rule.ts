import { z } from 'zod';

export const escalationTriggerTypes = [
  'communication_response_overdue',
  'workflow_exception_unresolved',
  'report_delivery_failed',
  'billing_review_stalled',
  'visit_reschedule_unapproved',
] as const;

export const escalationActionTypes = [
  'in_app_notification',
  'email_digest',
  'conference_task',
  'admin_alert',
] as const;

export const escalationNotifyRoles = [
  'admin',
  'manager',
  'pharmacist',
  'office_staff',
] as const;

export const escalationConditionSchema = z.object({
  threshold_hours: z.coerce.number().int().min(1).max(24 * 30),
  severity: z.enum(['normal', 'high', 'urgent']).optional(),
  status_in: z.array(z.string().min(1)).max(10).optional(),
});

export const createEscalationRuleSchema = z.object({
  trigger_type: z.enum(escalationTriggerTypes),
  condition: escalationConditionSchema,
  action: z.enum(escalationActionTypes),
  notify_role: z.enum(escalationNotifyRoles).nullable().optional(),
  is_active: z.boolean().default(true),
});

export const updateEscalationRuleSchema = z.object({
  trigger_type: z.enum(escalationTriggerTypes).optional(),
  condition: escalationConditionSchema.optional(),
  action: z.enum(escalationActionTypes).optional(),
  notify_role: z.enum(escalationNotifyRoles).nullable().optional(),
  is_active: z.boolean().optional(),
});

export type EscalationTriggerType = (typeof escalationTriggerTypes)[number];
export type EscalationActionType = (typeof escalationActionTypes)[number];
export type EscalationNotifyRole = (typeof escalationNotifyRoles)[number];
