import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/client';

export type CommunicationQueueDbClient = typeof prisma | Prisma.TransactionClient;
export type CommunicationQueueReader = {
  patientSelfReport?: {
    findMany(args: unknown): Promise<
      Array<{
        id: string;
        patient_id: string;
        subject: string;
        category?: string | null;
        requested_callback: boolean;
        preferred_contact_time: string | null;
        reported_by_name: string | null;
        status: string;
        created_at: Date;
      }>
    >;
  };
  visitScheduleContactLog?: {
    findMany(args: unknown): Promise<
      Array<{
        id: string;
        patient_id: string;
        schedule_id: string | null;
        outcome: string;
        contact_name: string | null;
        contact_phone: string | null;
        note: string | null;
        callback_due_at: Date | null;
        called_at: Date;
      }>
    >;
  };
  communicationRequest?: {
    findMany(args: unknown): Promise<
      Array<{
        id: string;
        patient_id: string | null;
        request_type: string;
        subject: string;
        content?: string | null;
        template_key?: string | null;
        related_entity_type?: string | null;
        related_entity_id?: string | null;
        status: string;
        due_date: Date | null;
        requested_at: Date;
      }>
    >;
  };
  communicationEvent?: {
    findMany(args: unknown): Promise<
      Array<{
        id: string;
        patient_id: string | null;
        channel: string;
        occurred_at: Date;
      }>
    >;
  };
  inboundCommunicationEvent?: {
    findMany(args: unknown): Promise<
      Array<{
        id: string;
        patient_id: string | null;
        source_channel: string;
        received_at: Date;
      }>
    >;
  };
  inboundCommunicationSignal?: {
    findMany(args: unknown): Promise<
      Array<{
        id: string;
        inbound_event_id: string;
        review_status: string;
        action_status: string;
      }>
    >;
  };
  task?: {
    findMany(args: unknown): Promise<
      Array<{
        id: string;
        task_type: string;
        status: string;
        priority: string;
        dedupe_key: string | null;
      }>
    >;
  };
  deliveryRecord?: {
    findMany(args: unknown): Promise<
      Array<{
        id: string;
        channel: string;
        recipient_name: string | null;
        status: string;
        failure_reason: string | null;
        sent_at: Date | null;
        confirmed_at: Date | null;
        updated_at: Date;
        report: {
          id: string;
          patient_id: string | null;
          report_type: string;
        };
      }>
    >;
  };
  externalAccessGrant?: {
    findMany(args: unknown): Promise<
      Array<{
        id: string;
        patient_id: string;
        granted_to_name: string;
        expires_at: Date;
        scope: string | null;
      }>
    >;
  };
  careReport?: {
    findMany(args: unknown): Promise<
      Array<{
        id: string;
        patient_id: string | null;
        report_type: string;
        status: string;
        created_at: Date;
        updated_at: Date | null;
      }>
    >;
  };
  tracingReport?: {
    findMany(args: unknown): Promise<
      Array<{
        id: string;
        patient_id: string;
        status: string;
        sent_to_physician: string | null;
        sent_at: Date | null;
        acknowledged_at: Date | null;
        updated_at: Date;
      }>
    >;
  };
  patient?: {
    findFirst?(args: unknown): Promise<{
      id: string;
      name: string;
      contacts?: Array<{
        name: string;
        relation: string;
        is_emergency_contact: boolean;
      }>;
      scheduling_preference?: {
        visit_before_contact_required: boolean | null;
      } | null;
    } | null>;
    findMany?(args: unknown): Promise<Array<{ id: string; name: string }>>;
  };
  medicationIssue?: {
    findMany(args: unknown): Promise<Array<{ title: string }>>;
  };
};

export type DbClient = CommunicationQueueReader;
export type QueuePriority = 'urgent' | 'high' | 'normal';
export type CommunicationQueueType =
  | 'self_report'
  | 'callback'
  | 'request'
  | 'delivery'
  | 'external_share'
  | 'inbound_communication';
export type ListCommunicationQueueArgs = {
  orgId: string;
  patientId?: string;
  patientIds?: string[];
  caseIds?: string[];
  limit?: number;
  queueTypes?: readonly CommunicationQueueType[];
  sourceScope?: 'all' | 'requested';
};
export const DEFAULT_COMMUNICATION_QUEUE_LIMIT = 8;

export function normalizeCommunicationQueueLimit(value: number | undefined) {
  if (value === undefined) return DEFAULT_COMMUNICATION_QUEUE_LIMIT;
  if (!Number.isFinite(value)) return DEFAULT_COMMUNICATION_QUEUE_LIMIT;

  const normalized = Math.trunc(value);
  if (!Number.isSafeInteger(normalized)) return DEFAULT_COMMUNICATION_QUEUE_LIMIT;

  return Math.max(normalized, 1);
}

export type CommunicationQueueItem = {
  id: string;
  queue_type: CommunicationQueueType;
  title: string;
  summary: string;
  channel: string;
  status: string;
  priority: QueuePriority;
  patient_id: string | null;
  patient_name: string | null;
  due_at: string | null;
  action_href: string;
  action_label: string;
};

export type CommunicationTimelineItem = {
  id: string;
  source_type: 'care_report' | 'tracing_report' | 'communication_request' | 'delivery_record';
  patient_id: string | null;
  patient_name: string | null;
  title: string;
  summary: string;
  status: string;
  occurred_at: string | null;
  action_href: string;
  action_label: string;
};

export type CommunicationDraftSuggestion = {
  id: string;
  patient_id: string;
  template_key:
    | 'missing_emergency_contact'
    | 'emergency_physician'
    | 'emergency_nurse'
    | 'emergency_family';
  request_type: string;
  target_name: string | null;
  target_role: string;
  title: string;
  summary: string;
  subject: string;
  content: string;
  action_href: string;
  action_label: string;
};

export type CommunicationQueueOverview = {
  summary: {
    pending_count: number;
    overdue_count: number;
    self_reports: number;
    callback_followups: number;
    inbound_communications: number;
    open_requests: number;
    delivery_backlog: number;
    expiring_external_shares: number;
    unconfirmed_count: number;
    reply_waiting_count: number;
    failed_count: number;
  };
  items: CommunicationQueueItem[];
  timeline: CommunicationTimelineItem[];
  emergency_drafts: CommunicationDraftSuggestion[];
};

export type TimelineSeed = {
  source_type: CommunicationTimelineItem['source_type'];
  id: string;
  patient_id: string | null;
  title: string;
  summary: string;
  status: string;
  occurred_at: Date | null;
  action_href: string;
  action_label: string;
};
