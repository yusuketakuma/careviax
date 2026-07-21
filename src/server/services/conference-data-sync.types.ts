import type { Prisma } from '@prisma/client';
import type { ConferenceSyncTransactionClient } from '@/server/services/conference-sync';

export type TransactionClient = {
  billingCandidate: ConferenceSyncTransactionClient['billingCandidate'];
  careCase: {
    findFirst(args: unknown): Promise<CareCaseSummary | null>;
    update(args: unknown): Promise<unknown>;
  };
  careReport: ConferenceSyncTransactionClient['careReport'];
  conferenceNote: {
    update(args: unknown): Promise<PersistedConferenceNote>;
  };
  consentRecord: ConferenceSyncTransactionClient['consentRecord'];
  facility: {
    findFirst(
      args: unknown,
    ): Promise<{ acceptance_time_from: Date | null; acceptance_time_to: Date | null } | null>;
  };
  managementPlan: ConferenceSyncTransactionClient['managementPlan'];
  medicationIssue: {
    findMany(args: unknown): Promise<Array<{ title: string }>>;
    createMany(args: unknown): Promise<unknown>;
  };
  patientSchedulePreference: {
    upsert(args: unknown): Promise<unknown>;
  };
  residence: {
    findFirst(args: unknown): Promise<{ facility_id: string | null } | null>;
  };
  task: {
    findMany?(args: unknown): Promise<Array<{ dedupe_key: string | null }>>;
    createMany?(args: unknown): Promise<unknown>;
    create(args: unknown): Promise<unknown>;
    updateMany(args: unknown): Promise<unknown>;
    upsert(args: unknown): Promise<unknown>;
  };
  visitSchedule: {
    findFirst(args: unknown): Promise<{
      id: string;
      cycle_id: string | null;
      site_id: string | null;
      visit_type: string;
      priority: string;
      scheduled_date: Date;
      time_window_start: Date | null;
      time_window_end: Date | null;
      medication_end_date: Date | null;
      visit_deadline_date: Date | null;
      route_order: number | null;
      recurrence_rule: string | null;
    } | null>;
    findMany(args: unknown): Promise<
      Array<{
        scheduled_date: Date;
        pharmacist_id: string;
        route_order: number | null;
      }>
    >;
  };
  visitScheduleProposal: {
    findFirst(args: unknown): Promise<{ id: string } | null>;
    findMany(args: unknown): Promise<
      Array<{
        proposed_date: Date;
        proposed_pharmacist_id: string;
        route_order: number | null;
        reschedule_source_schedule_id: string | null;
      }>
    >;
    create(args: unknown): Promise<{ id: string }>;
    update(args: unknown): Promise<{ id: string }>;
  };
};

export type PersistedConferenceNote = {
  id: string;
  case_id: string | null;
  patient_id: string | null;
  facility_id: string | null;
  note_type: string;
  title: string;
  content: string;
  structured_content: Prisma.JsonValue | null;
  metadata: Prisma.JsonValue | null;
  billing_eligible: boolean;
  billing_code: string | null;
  follow_up_date: Date | null;
  follow_up_completed: boolean;
  generated_report_id: string | null;
  participants: Prisma.JsonValue;
  conference_date: Date;
  action_items: Prisma.JsonValue | null;
};

export type StructuredSection = {
  key: string;
  label: string;
  body?: string;
};

export type CareCaseSummary = {
  id: string;
  patient_id: string;
  primary_pharmacist_id: string | null;
  required_visit_support: JsonLike;
};

export type ConferenceDerivedSyncResult = {
  tasksCreated: number;
  medicationIssuesCreated: number;
  visitProposalId?: string | null;
  metadataPatch?: Prisma.InputJsonObject | null;
};

export type JsonLike = unknown;
