export type ReportType =
  | 'physician_report'
  | 'care_manager_report'
  | 'facility_handoff'
  | 'nurse_share'
  | 'family_share'
  | 'internal_record';

export type ConferenceSyncTransactionClient = {
  billingCandidate: {
    upsert(args: unknown): Promise<{ id: string }>;
  };
  careCase: {
    findFirst(
      args: unknown,
    ): Promise<{ patient_id: string | null; primary_pharmacist_id: string | null } | null>;
  };
  careReport: {
    findMany?(args: unknown): Promise<Array<{ id: string; report_type: ReportType }>>;
    createMany?(args: unknown): Promise<unknown>;
    findFirst?(args: unknown): Promise<{ id: string } | null>;
    create?(args: unknown): Promise<{ id: string }>;
  };
  consentRecord: {
    findFirst(args: unknown): Promise<{ id: string } | null>;
  };
  managementPlan: {
    findFirst(args: unknown): Promise<{ id: string } | null>;
  };
  medicationIssue: {
    findMany?(args: unknown): Promise<Array<{ title: string }>>;
    createMany?(args: unknown): Promise<unknown>;
    create?(args: unknown): Promise<unknown>;
  };
  task: {
    findMany?(args: unknown): Promise<Array<{ dedupe_key: string | null }>>;
    createMany?(args: unknown): Promise<unknown>;
    upsert?(args: unknown): Promise<unknown>;
  };
  visitScheduleProposal: {
    findFirst(args: unknown): Promise<{ id: string } | null>;
    create(args: unknown): Promise<{ id: string }>;
  };
};

export type TransactionClient = ConferenceSyncTransactionClient;

export type ActionItem = {
  title?: string;
  assignee?: string;
  converted_task_id?: string;
  converted_at?: string;
};

export type StructuredSection = {
  key: string;
  label: string;
  body?: string;
};

export type Participant = {
  name?: string;
  role?: string;
  attended?: boolean;
  is_report_recipient?: boolean;
  organization_name?: string;
  email?: string;
  fax?: string;
};

export type NoteInput = {
  id: string;
  case_id: string | null;
  patient_id?: string | null;
  note_type: string;
  title: string;
  content?: string;
  /** ISO 8601 string or Date — when the conference was held */
  conference_date?: Date | string;
  /** [{name, role}] participant list */
  participants?: unknown;
  structured_content: unknown;
  metadata: unknown;
  action_items: unknown;
};

export interface ConferenceSyncResult {
  tasks_created: number;
  billing_candidate_id?: string;
  visit_proposal_id?: string;
  medication_issues_created: number;
  report_draft_ids?: string[];
}
