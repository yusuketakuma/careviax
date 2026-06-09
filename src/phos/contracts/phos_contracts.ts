export const UserRole = {
  PHARMACIST: 'PHARMACIST',
  PHARMACY_CLERK: 'PHARMACY_CLERK',
  DISPENSE_ASSISTANT: 'DISPENSE_ASSISTANT',
  MANAGER: 'MANAGER',
  ADMIN: 'ADMIN',
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];

export const CardType = {
  PRESCRIPTION: 'PRESCRIPTION',
  VISIT_PREP: 'VISIT_PREP',
  REPORT_FOLLOWUP: 'REPORT_FOLLOWUP',
  FACILITY_TASK: 'FACILITY_TASK',
  INITIAL_CONTRACT: 'INITIAL_CONTRACT',
  DOCUMENT_DELIVERY: 'DOCUMENT_DELIVERY',
  CARE_CONFERENCE: 'CARE_CONFERENCE',
  EMERGENCY_CALL: 'EMERGENCY_CALL',
  CRITERIA_MANAGEMENT: 'CRITERIA_MANAGEMENT',
} as const;
export type CardType = (typeof CardType)[keyof typeof CardType];

export const CurrentStep = {
  INTAKE: 'INTAKE',
  DIFF_REVIEW: 'DIFF_REVIEW',
  DISPENSING: 'DISPENSING',
  DISPENSING_AUDIT: 'DISPENSING_AUDIT',
  SET_PREP: 'SET_PREP',
  SETTING: 'SETTING',
  SET_AUDIT: 'SET_AUDIT',
  VISIT_ASSIGNMENT: 'VISIT_ASSIGNMENT',
  VISIT_READY_CHECK: 'VISIT_READY_CHECK',
  VISIT_READY: 'VISIT_READY',
  VISIT_IN_PROGRESS: 'VISIT_IN_PROGRESS',
  REPORT: 'REPORT',
  REPORT_SEND: 'REPORT_SEND',
  CLAIM_REVIEW: 'CLAIM_REVIEW',
  CLOSING: 'CLOSING',
  CLOSED: 'CLOSED',
} as const;
export type CurrentStep = (typeof CurrentStep)[keyof typeof CurrentStep];

export const DisplayStatus = {
  READY: 'READY',
  WAITING: 'WAITING',
  IN_PROGRESS: 'IN_PROGRESS',
  BLOCKED: 'BLOCKED',
  REVIEW_REQUIRED: 'REVIEW_REQUIRED',
  REJECTED: 'REJECTED',
  CLOSED: 'CLOSED',
  CANCELED: 'CANCELED',
} as const;
export type DisplayStatus = (typeof DisplayStatus)[keyof typeof DisplayStatus];

export const BlockerSeverity = {
  INFO: 'INFO',
  WARNING: 'WARNING',
  ERROR: 'ERROR',
  CRITICAL: 'CRITICAL',
} as const;
export type BlockerSeverity = (typeof BlockerSeverity)[keyof typeof BlockerSeverity];

export const ActionKind = {
  STEP_CHANGING: 'STEP_CHANGING',
  INTRA_STEP: 'INTRA_STEP',
  DETACHED: 'DETACHED',
} as const;
export type ActionKind = (typeof ActionKind)[keyof typeof ActionKind];

export const ActionCode = {
  REGISTER_PRESCRIPTION: 'REGISTER_PRESCRIPTION',
  CONFIRM_PRESCRIPTION_DIFF: 'CONFIRM_PRESCRIPTION_DIFF',
  START_DISPENSING: 'START_DISPENSING',
  COMPLETE_DISPENSING: 'COMPLETE_DISPENSING',
  START_DISPENSING_AUDIT: 'START_DISPENSING_AUDIT',
  APPROVE_DISPENSING_AUDIT: 'APPROVE_DISPENSING_AUDIT',
  REJECT_DISPENSING_AUDIT: 'REJECT_DISPENSING_AUDIT',
  CREATE_SET_INSTRUCTION: 'CREATE_SET_INSTRUCTION',
  COMPLETE_SET: 'COMPLETE_SET',
  START_SET_AUDIT: 'START_SET_AUDIT',
  APPROVE_SET_AUDIT: 'APPROVE_SET_AUDIT',
  REJECT_SET_AUDIT: 'REJECT_SET_AUDIT',
  ASSIGN_TO_VISIT_PACKET: 'ASSIGN_TO_VISIT_PACKET',
  SCHEDULE_VISIT_PACKET: 'SCHEDULE_VISIT_PACKET',
  CONFIRM_VISIT_READY: 'CONFIRM_VISIT_READY',
  START_VISIT: 'START_VISIT',
  COMPLETE_VISIT: 'COMPLETE_VISIT',
  CREATE_REPORT_DRAFT: 'CREATE_REPORT_DRAFT',
  APPROVE_REPORT: 'APPROVE_REPORT',
  SEND_REPORT: 'SEND_REPORT',
  MARK_REPORT_WAITING_REPLY: 'MARK_REPORT_WAITING_REPLY',
  REGISTER_REPORT_REPLY: 'REGISTER_REPORT_REPLY',
  MARK_REPORT_ACTION_DONE: 'MARK_REPORT_ACTION_DONE',
  REVIEW_CLAIM_CANDIDATES: 'REVIEW_CLAIM_CANDIDATES',
  EXCLUDE_CLAIM_CANDIDATE: 'EXCLUDE_CLAIM_CANDIDATE',
  CLOSE_CARD: 'CLOSE_CARD',
  REOPEN_CARD: 'REOPEN_CARD',
  CANCEL_CARD: 'CANCEL_CARD',
  UPLOAD_EVIDENCE: 'UPLOAD_EVIDENCE',
  CREATE_HANDOFF_TO_PHARMACIST: 'CREATE_HANDOFF_TO_PHARMACIST',
  RESOLVE_CLERK_BLOCKER: 'RESOLVE_CLERK_BLOCKER',
} as const;
export type ActionCode = (typeof ActionCode)[keyof typeof ActionCode];

export const ButtonState = {
  ACTIONABLE: 'ACTIONABLE',
  RESOLVABLE_BLOCK: 'RESOLVABLE_BLOCK',
  FOREIGN_BLOCK: 'FOREIGN_BLOCK',
  NO_PERMISSION: 'NO_PERMISSION',
  READONLY_CLOSED: 'READONLY_CLOSED',
  OFFLINE_BLOCKED: 'OFFLINE_BLOCKED',
} as const;
export type ButtonState = (typeof ButtonState)[keyof typeof ButtonState];

export type NextActionView = {
  code: ActionCode;
  kind: ActionKind;
  label_key: string;
  enabled: boolean;
  disabled_reason_key?: string;
  offline_allowed: boolean;
  priority: 'PRIMARY' | 'SECONDARY' | 'DANGER' | 'INFO';
  required_role: UserRole[];
  target_endpoint: string;
  ui_state: ButtonState;
  can_user_handle: boolean;
  reason_required?: boolean;
};

export type ButtonStateContext = {
  card: { display_status: DisplayStatus; current_step: CurrentStep };
  nextAction: NextActionView;
  isOffline: boolean;
  blockingBlocker?: { code: BlockerCode; severity: BlockerSeverity; owner_role: UserRole };
  canUserHandleBlocker: boolean;
  noPermission: boolean;
};

export const Tag = {
  NARCOTIC: 'NARCOTIC',
  OPIOID: 'OPIOID',
  HIGH_RISK: 'HIGH_RISK',
  COLD_CHAIN: 'COLD_CHAIN',
  INSULIN: 'INSULIN',
  ANTICOAGULANT: 'ANTICOAGULANT',
  MULTI_PERSON_VISIT: 'MULTI_PERSON_VISIT',
  DOCTOR_SIMULTANEOUS: 'DOCTOR_SIMULTANEOUS',
  PRESCRIPTION_DIFF: 'PRESCRIPTION_DIFF',
  SET_DIFF: 'SET_DIFF',
  RESIDUAL: 'RESIDUAL',
  FALL_RISK: 'FALL_RISK',
  HYPOGLYCEMIA_RISK: 'HYPOGLYCEMIA_RISK',
  REPORT_REQUIRED: 'REPORT_REQUIRED',
  CLAIM_CANDIDATE: 'CLAIM_CANDIDATE',
  CLERK_CAN_RESOLVE: 'CLERK_CAN_RESOLVE',
  WAITING_REPLY: 'WAITING_REPLY',
} as const;
export type Tag = (typeof Tag)[keyof typeof Tag];

export const SAFETY_CRITICAL_TAGS: readonly Tag[] = [
  Tag.NARCOTIC,
  Tag.OPIOID,
  Tag.HIGH_RISK,
  Tag.COLD_CHAIN,
  Tag.INSULIN,
  Tag.ANTICOAGULANT,
  Tag.MULTI_PERSON_VISIT,
  Tag.DOCTOR_SIMULTANEOUS,
];

export const VisitStep = {
  ARRIVAL_CONFIRM: 'ARRIVAL_CONFIRM',
  TODAY_BRIEF_ACK: 'TODAY_BRIEF_ACK',
  DELIVERY_AND_SET: 'DELIVERY_AND_SET',
  RESIDUAL_CHECK: 'RESIDUAL_CHECK',
  ADHERENCE_ADR_CHECK: 'ADHERENCE_ADR_CHECK',
  EXPLANATION: 'EXPLANATION',
  NEXT_SCHEDULE: 'NEXT_SCHEDULE',
  EVIDENCE_UPLOAD: 'EVIDENCE_UPLOAD',
  REPORT_SEED: 'REPORT_SEED',
  COMPLETE_CHECK: 'COMPLETE_CHECK',
} as const;
export type VisitStep = (typeof VisitStep)[keyof typeof VisitStep];

export type OfflineOpClass = 'BLOCKING' | 'NON_BLOCKING';

export const SourceRefKind = {
  PRESCRIPTION: 'PRESCRIPTION',
  PREVIOUS_VISIT: 'PREVIOUS_VISIT',
  MEDICATION_HISTORY: 'MEDICATION_HISTORY',
  OTHER_PRO_MESSAGE: 'OTHER_PRO_MESSAGE',
  RULE_DOCUMENT: 'RULE_DOCUMENT',
  EVIDENCE_FILE: 'EVIDENCE_FILE',
  CARE_PLAN: 'CARE_PLAN',
} as const;
export type SourceRefKind = (typeof SourceRefKind)[keyof typeof SourceRefKind];
export const SOURCE_REF_KINDS = Object.values(SourceRefKind);

export type SourceRef = {
  kind: SourceRefKind;
  ref_id: string;
  label: string;
  uri?: string;
  captured_at?: string;
};

export type TagView = {
  code: Tag;
  label: string;
  severity: BlockerSeverity;
  icon: string;
  safety_critical: boolean;
};

export type BlockerCode = string;

export type BlockerView = {
  blocker_code: BlockerCode;
  severity: BlockerSeverity;
  owner_role: UserRole;
  message_key: string;
  message_params?: Record<string, string>;
  required_action_code?: ActionCode;
  active: boolean;
};

export type BlockerSummaryView = {
  top: BlockerView;
  blocking_count: number;
  total_count: number;
};

export type CommunicationIntent =
  | 'ASK_PRESCRIBER'
  | 'SHARE_CARE_TEAM'
  | 'REPORT_DELIVERY'
  | 'REPLY_FOLLOWUP'
  | 'FAMILY_CONFIRMATION';

export const ClaimCandidateStatus = {
  CANDIDATE: 'CANDIDATE',
  MISSING_EVIDENCE: 'MISSING_EVIDENCE',
  READY: 'READY',
  EXCLUDED: 'EXCLUDED',
  APPROVED: 'APPROVED',
} as const;
export type ClaimCandidateStatus = (typeof ClaimCandidateStatus)[keyof typeof ClaimCandidateStatus];

export type FeeRuleConditionDsl =
  | { op: 'EXISTS'; field: string }
  | { op: 'EQ'; field: string; value: string | number | boolean }
  | { op: 'IN'; field: string; values: (string | number | boolean)[] }
  | { op: 'GTE'; field: string; value: number }
  | { op: 'LTE'; field: string; value: number }
  | { op: 'AND'; conditions: FeeRuleConditionDsl[] }
  | { op: 'OR'; conditions: FeeRuleConditionDsl[] }
  | { op: 'NOT'; condition: FeeRuleConditionDsl };

export type EvidenceRequirementView = {
  evidence_key: string;
  label: string;
  required: boolean;
  source_kind: SourceRef['kind'];
};

export type FeeRuleView = {
  rule_id: string;
  rule_version_id: string;
  fee_code: string;
  fee_label: string;
  tenant_scope: 'SYSTEM' | 'TENANT';
  revision_code: string;
  active_from: string;
  active_to?: string;
  condition: FeeRuleConditionDsl;
  evidence_requirements: EvidenceRequirementView[];
  source_refs: SourceRef[];
};

export type FeeRuleSearchResponse = {
  items: FeeRuleView[];
  next_cursor?: string;
  server_time: string;
};

export type ClinicalSignal = {
  code:
    | 'DOSE_INCREASE'
    | 'NEW_HIGH_RISK'
    | 'DISCONTINUATION'
    | 'INTERACTION_SUSPECT'
    | 'ADHERENCE_DROP'
    | 'ADR_SUSPECT'
    | 'RESIDUAL_EXCESS'
    | 'RENAL_HEPATIC_WATCH';
  severity: BlockerSeverity;
  title: string;
  detail: string;
  source_refs: SourceRef[];
  recommended_action_code?: ActionCode;
};

export type DecisionOption = {
  code: 'NO_ISSUE' | 'ASK_PRESCRIBER' | 'SHARE_CARE_TEAM' | 'DEFER_NEXT_VISIT' | 'REJECT';
  label: string;
  requires_note: boolean;
  emits_action_code?: ActionCode;
};

export type PharmacistDecisionRequired = {
  decision_id: string;
  reason_code:
    | 'DIFF_REVIEW'
    | 'RESIDUAL_ADJUSTMENT'
    | 'ADVERSE_EVENT'
    | 'CLAIM_JUDGE'
    | 'VISIT_SAFETY';
  title: string;
  why: string;
  source_refs: SourceRef[];
  options: DecisionOption[];
};

export type CommunicationRecommendation = {
  intent: CommunicationIntent;
  target_type: 'DOCTOR' | 'CARE_MANAGER' | 'VISITING_NURSE' | 'FACILITY' | 'FAMILY';
  rationale: string;
  draft_seed_key: string;
};

export type ClaimWarning = {
  fee_code: string;
  status: ClaimCandidateStatus;
  status_label: string;
  missing_evidence_keys: string[];
  next_action_code?: ActionCode;
};

export type PharmacistBrief = {
  clinical_signals: ClinicalSignal[];
  decisions_required: PharmacistDecisionRequired[];
  communication_recommendations: CommunicationRecommendation[];
  claim_warnings: ClaimWarning[];
  source_refs: SourceRef[];
};

export type MissingContactView = {
  contact_id: string;
  target_type: CommunicationRecommendation['target_type'];
  label: string;
  required_field_keys: string[];
};

export type DeliveryTargetView = {
  target_id: string;
  target_type: CommunicationRecommendation['target_type'];
  label: string;
  delivery_method: 'FAX' | 'EMAIL' | 'PHONE' | 'HAND_DELIVERY' | 'MCS';
  ready: boolean;
};

export type ReportComposerSectionView = {
  section_key: string;
  label: string;
  body: string;
};

export type ReportComposerView = {
  card_id: string;
  patient_name: string;
  delivery_targets: DeliveryTargetView[];
  communication_recommendations: CommunicationRecommendation[];
  template_sections: ReportComposerSectionView[];
  body: string;
  source_refs: SourceRef[];
};

export type ScheduleCandidateView = {
  candidate_id: string;
  date: string;
  start_time: string;
  end_time: string;
  label: string;
};

export type EvidenceMissingView = {
  evidence_key: string;
  label: string;
  required: boolean;
  related_action_code?: ActionCode;
};

export type EvidencePendingView = {
  evidence_key: string;
  label: string;
  offline_op_class: OfflineOpClass;
  created_at: string;
  retry_count: number;
};

export type WaitingReplyView = {
  delivery_id: string;
  target_label: string;
  sent_at: string;
  stale_minutes: number;
};

export const ReportDeliveryStatus = {
  WAITING_REPLY: 'WAITING_REPLY',
  REPLIED: 'REPLIED',
  ACTION_REQUIRED: 'ACTION_REQUIRED',
  ACTION_DONE: 'ACTION_DONE',
} as const;
export type ReportDeliveryStatus = (typeof ReportDeliveryStatus)[keyof typeof ReportDeliveryStatus];

export type ReportDeliveryView = WaitingReplyView & {
  card_id: string;
  report_id: string;
  patient_name: string;
  status: ReportDeliveryStatus;
  delivery_method: DeliveryTargetView['delivery_method'];
  server_version: number;
  reply_due_at?: string;
  reply_received_at?: string;
  reply_summary?: string;
  action_required_note?: string;
  action_done_at?: string;
  action_done_by_user_id?: string;
  last_contacted_at?: string;
  source_refs: SourceRef[];
};

export type RegisterReportReplyRequest = {
  result_status: Exclude<ReportDeliveryStatus, 'WAITING_REPLY'>;
  reply_summary: string;
  reply_received_at?: string;
  action_required_note?: string;
  source_refs?: SourceRef[];
  idempotency_key: string;
  client_version: number;
};

export type MarkReportActionDoneRequest = {
  action_note: string;
  idempotency_key: string;
  client_version: number;
};

export type PharmacistReviewReason = {
  reason_code: PharmacistDecisionRequired['reason_code'];
  label: string;
  source_refs: SourceRef[];
};

export type SupportTaskView = {
  task_code:
    | 'INTAKE'
    | 'CONTACT_SETUP'
    | 'SCHEDULE_INPUT'
    | 'DOCUMENT_RECORD'
    | 'REPORT_PREP'
    | 'REPLY_FOLLOWUP'
    | 'EVIDENCE_ATTACH';
  label: string;
  related_blocker_code?: BlockerCode;
  enabled: boolean;
};

export type SupportBrief = {
  support_tasks: SupportTaskView[];
  missing_contacts: MissingContactView[];
  delivery_targets: DeliveryTargetView[];
  schedule_candidates: ScheduleCandidateView[];
  missing_evidences: EvidenceMissingView[];
  waiting_replies: WaitingReplyView[];
  pharmacist_review_reasons: PharmacistReviewReason[];
};

export type ToastTone = 'SUCCESS' | 'INFO' | 'WARNING' | 'ERROR';
export type TabKey = 'OVERVIEW' | 'PRESCRIPTION' | 'SET' | 'VISIT_REPORT' | 'CLAIM_HISTORY';

export type CardSummaryView = {
  card_id: string;
  card_type: CardType;
  patient_name: string;
  facility_name?: string;
  room?: string;
  visit_time?: string;
  visit_date?: string;
  service_date?: string;
  due_at?: string;
  updated_at?: string;
  stale_minutes?: number;
  urgency_rank?: number;
  current_step: CurrentStep;
  display_status: DisplayStatus;
  assigned_user?: string;
  server_version: number;
  tags: TagView[];
  quick_filter_keys?: BoardQuickFilter[];
  triage_lanes?: TriageLane[];
  search_texts?: string[];
  blocker_summary?: BlockerSummaryView;
};

export type PermissionsView = {
  can_read: boolean;
  can_write: boolean;
  allowed_actions: ActionCode[];
};

export type SideEffect =
  | { type: 'TASK_COMPLETED'; task_id: string }
  | { type: 'BLOCKER_RESOLVED'; blocker_code: BlockerCode }
  | { type: 'BLOCKER_CREATED'; blocker_code: BlockerCode; severity: BlockerSeverity }
  | { type: 'READY_CHECK_RECALCULATED'; visit_packet_id: string }
  | { type: 'CLAIM_RECALCULATED'; card_id: string }
  | { type: 'HANDOFF_CREATED'; handoff_id: string }
  | { type: 'REPORT_QUEUED'; delivery_id: string }
  | { type: 'REPORT_REPLY_REGISTERED'; delivery_id: string; status: ReportDeliveryStatus }
  | { type: 'REPORT_ACTION_DONE'; delivery_id: string }
  | { type: 'CARD_GENERATED'; card_id: string; card_type: CardType };

export type ActionResponse = {
  card: CardSummaryView;
  next_action: NextActionView;
  display_status: DisplayStatus;
  blockers: BlockerView[];
  visible_tabs?: TabKey[];
  side_effects: SideEffect[];
  toast?: { tone: ToastTone; message_key: string; params?: Record<string, string> };
  server_version: number;
};

export const ViewPhase = {
  LOADING: 'LOADING',
  READY: 'READY',
  EMPTY: 'EMPTY',
  ERROR: 'ERROR',
  STALE: 'STALE',
} as const;
export type ViewPhase = (typeof ViewPhase)[keyof typeof ViewPhase];

export const ActionPhase = {
  IDLE: 'IDLE',
  SUBMITTING: 'SUBMITTING',
  SUCCEEDED: 'SUCCEEDED',
  GUARD_FAILED: 'GUARD_FAILED',
  CONFLICT: 'CONFLICT',
  NET_ERROR: 'NET_ERROR',
} as const;
export type ActionPhase = (typeof ActionPhase)[keyof typeof ActionPhase];

export const RejectReason = {
  WRONG_DRUG: 'WRONG_DRUG',
  WRONG_DOSE: 'WRONG_DOSE',
  WRONG_TIMING: 'WRONG_TIMING',
  WRONG_QUANTITY: 'WRONG_QUANTITY',
  DISCONTINUED_NOT_REMOVED: 'DISCONTINUED_NOT_REMOVED',
  PHOTO_INSUFFICIENT: 'PHOTO_INSUFFICIENT',
  OTHER: 'OTHER',
} as const;
export type RejectReason = (typeof RejectReason)[keyof typeof RejectReason];

export type VisitModeView = {
  packet_id: string;
  card_id?: string;
  assignee_user_id?: string;
  support_user_ids?: string[];
  server_version: number;
  patient_name: string;
  facility?: string;
  room?: string;
  visit_status: VisitStatus;
  applicable_steps: VisitStep[];
  required_steps: VisitStep[];
  step_completed: Record<VisitStep, boolean>;
  last_opened_step: VisitStep;
  evidence_sync: {
    blocking_unsynced_count: number;
    non_blocking_unsynced_count: number;
  };
  blockers?: BlockerView[];
  online: boolean;
};

export const VisitArrivalOutcome = {
  PRESENT: 'PRESENT',
  ABSENT: 'ABSENT',
  POSTPONED: 'POSTPONED',
  CANCELED: 'CANCELED',
} as const;
export type VisitArrivalOutcome = (typeof VisitArrivalOutcome)[keyof typeof VisitArrivalOutcome];

export const VisitStatus = {
  SCHEDULED: 'SCHEDULED',
  IN_PROGRESS: 'IN_PROGRESS',
  POST_VISIT_PENDING: 'POST_VISIT_PENDING',
  COMPLETED: 'COMPLETED',
  CANCELED: 'CANCELED',
} as const;
export type VisitStatus = (typeof VisitStatus)[keyof typeof VisitStatus];

export const HandoffStatus = {
  OPEN: 'OPEN',
  IN_REVIEW: 'IN_REVIEW',
  RESOLVED: 'RESOLVED',
  RETURNED: 'RETURNED',
} as const;
export type HandoffStatus = (typeof HandoffStatus)[keyof typeof HandoffStatus];

export const HandoffUrgency = {
  LOW: 'LOW',
  NORMAL: 'NORMAL',
  HIGH: 'HIGH',
  URGENT: 'URGENT',
} as const;
export type HandoffUrgency = (typeof HandoffUrgency)[keyof typeof HandoffUrgency];

export const CapacityScope = {
  PHARMACY: 'PHARMACY',
  ME: 'ME',
} as const;
export type CapacityScope = (typeof CapacityScope)[keyof typeof CapacityScope];

export const CapacityStatus = {
  AVAILABLE: 'AVAILABLE',
  TIGHT: 'TIGHT',
  OVER_CAPACITY: 'OVER_CAPACITY',
  UNREGISTERED: 'UNREGISTERED',
} as const;
export type CapacityStatus = (typeof CapacityStatus)[keyof typeof CapacityStatus];

export type HandoffToPharmacist = {
  handoff_id: string;
  card_id: string;
  status: HandoffStatus;
  reason_code: string;
  summary: string;
  source_refs: SourceRef[];
  requested_action?: ActionCode;
  urgency: HandoffUrgency;
  related_blocker_code?: BlockerCode;
  created_by_user_id: string;
  assignee_user_id?: string;
  created_at: string;
  updated_at: string;
  server_version: number;
};

export type HandoffView = HandoffToPharmacist & {
  patient_name: string;
  age_minutes: number;
  return_reason_code?: string;
  return_note?: string;
  resolved_action_code?: ActionCode;
};

export type HandoffAssigneeQuery = 'ME' | string;

export type HandoffSearchQuery = {
  status?: HandoffStatus;
  assignee?: HandoffAssigneeQuery;
  cursor?: string;
  limit?: number;
};

export type HandoffSearchResponse = {
  items: HandoffView[];
  next_cursor?: string;
  total_estimate?: number;
  server_time: string;
};

export type CreateHandoffRequest = {
  card_id: string;
  reason_code: string;
  summary: string;
  source_refs: SourceRef[];
  urgency: HandoffUrgency;
  requested_action?: ActionCode;
  assignee_user_id?: string;
  related_blocker_code?: BlockerCode;
  idempotency_key: string;
  client_version: number;
};

export type ResolveHandoffRequest = {
  resolved_action_code: ActionCode;
  idempotency_key: string;
  client_version: number;
};

export type OpenHandoffRequest = {
  idempotency_key: string;
  client_version: number;
};

export type ReturnHandoffRequest = {
  return_reason_code: string;
  return_note: string;
  idempotency_key: string;
  client_version: number;
};

export type HandoffMutationResponse = {
  handoff: HandoffView;
  side_effects: SideEffect[];
  toast?: { tone: ToastTone; message_key: string; params?: Record<string, string> };
  server_version: number;
};

export type CapacityWorkBucket = {
  bucket_code: 'INTAKE' | 'DISPENSING' | 'AUDIT' | 'VISIT' | 'REPORT' | 'CLAIM' | 'OTHER';
  label: string;
  planned_minutes: number;
  available_minutes: number;
  utilization_percent: number;
};

export type CapacityStaffLoad = {
  user_id: string;
  display_name: string;
  role: UserRole;
  planned_minutes: number;
  available_minutes: number;
  utilization_percent: number;
  active_card_count: number;
};

export type CapacityBottleneck = {
  bottleneck_code: string;
  label: string;
  severity: BlockerSeverity;
  affected_count: number;
  over_minutes?: number;
};

export type CapacityResponse = {
  date: string;
  scope: CapacityScope;
  status: CapacityStatus;
  total_planned_minutes: number;
  total_available_minutes: number;
  utilization_percent: number;
  work_buckets: CapacityWorkBucket[];
  staff_loads: CapacityStaffLoad[];
  bottlenecks: CapacityBottleneck[];
  server_time: string;
};

export type ClaimCandidateView = {
  candidate_id: string;
  card_id: string;
  patient_name: string;
  fee_code: string;
  fee_label: string;
  billing_month: string;
  status: ClaimCandidateStatus;
  status_label: string;
  missing_evidence_keys: string[];
  evidence_requirements: EvidenceRequirementView[];
  rule_version_id: string;
  priority_rank: number;
  source_refs: SourceRef[];
  created_at: string;
  updated_at: string;
  server_version: number;
  excluded_reason_code?: string;
  excluded_reason_note?: string;
};

export type ClaimCandidateSearchResponse = {
  items: ClaimCandidateView[];
  next_cursor?: string;
  total_estimate?: number;
  server_time: string;
};

export type ExcludeClaimCandidateRequest = {
  reason_code: string;
  reason_note?: string;
  idempotency_key: string;
  client_version: number;
};

export type ClaimCandidateMutationResponse = {
  candidate: ClaimCandidateView;
  side_effects: SideEffect[];
  toast?: { tone: ToastTone; message_key: string; params?: Record<string, string> };
  server_version: number;
};

export type ErrorResponse = {
  request_id: string;
  error_code:
    | 'TENANT_ID_IN_PAYLOAD_FORBIDDEN'
    | 'TENANT_CONTEXT_MISSING'
    | 'FORBIDDEN'
    | 'ACTION_GUARD_FAILED'
    | 'IDEMPOTENCY_CONFLICT'
    | 'STALE_VERSION'
    | 'VALIDATION_ERROR'
    | 'NOT_FOUND'
    | 'INTERNAL_ERROR';
  message_key: string;
  details?: Record<string, unknown>;
};

export type CardBoardItemView = {
  card: CardSummaryView;
  next_action: NextActionView;
};

export const BoardQuickFilter = {
  ALL: 'ALL',
  TODAY: 'TODAY',
  MY_ASSIGNED: 'MY_ASSIGNED',
  INCOMPLETE: 'INCOMPLETE',
  PHARMACIST_REVIEW: 'PHARMACIST_REVIEW',
  CLERK_READY: 'CLERK_READY',
  SET_AUDIT_WAITING: 'SET_AUDIT_WAITING',
  VISIT_READY_CHECK: 'VISIT_READY_CHECK',
  REPORT_UNSENT: 'REPORT_UNSENT',
  WAITING_REPLY: 'WAITING_REPLY',
  MISSING_EVIDENCE: 'MISSING_EVIDENCE',
  URGENT: 'URGENT',
} as const;
export type BoardQuickFilter = (typeof BoardQuickFilter)[keyof typeof BoardQuickFilter];

export const TriageLane = {
  TODAY_VISIT: 'TODAY_VISIT',
  PHARMACIST_REVIEW: 'PHARMACIST_REVIEW',
  CLERK_READY: 'CLERK_READY',
  REPORT_UNSENT: 'REPORT_UNSENT',
  WAITING_REPLY: 'WAITING_REPLY',
  MISSING_EVIDENCE: 'MISSING_EVIDENCE',
} as const;
export type TriageLane = (typeof TriageLane)[keyof typeof TriageLane];

export const BoardSortKey = {
  VISIT_TIME: 'VISIT_TIME',
  URGENCY: 'URGENCY',
  STALE_TIME: 'STALE_TIME',
  CURRENT_STEP: 'CURRENT_STEP',
  ASSIGNEE: 'ASSIGNEE',
  FACILITY: 'FACILITY',
  UPDATED: 'UPDATED',
} as const;
export type BoardSortKey = (typeof BoardSortKey)[keyof typeof BoardSortKey];

export const BoardDensity = {
  COMFORTABLE: 'COMFORTABLE',
  COMPACT: 'COMPACT',
} as const;
export type BoardDensity = (typeof BoardDensity)[keyof typeof BoardDensity];

export type CardSearchResponse = {
  items: CardBoardItemView[];
  next_cursor?: string;
  total_estimate?: number;
  server_time: string;
};

export type ReportDeliverySearchResponse = {
  items: ReportDeliveryView[];
  next_cursor?: string;
  server_time: string;
};

export type ReportDeliveryMutationResponse = {
  delivery: ReportDeliveryView;
  side_effects: SideEffect[];
  server_version: number;
};

export type CardDetailResponse = {
  card: CardSummaryView;
  visible_tabs: TabKey[];
  permissions: PermissionsView;
  next_action: NextActionView;
  pharmacist_brief?: PharmacistBrief;
  support_brief?: SupportBrief;
  blockers: BlockerView[];
  handoffs?: HandoffView[];
  visit_mode?: VisitModeView;
  source_refs: SourceRef[];
  server_version: number;
};

export type ActionRequest = {
  action_code: ActionCode;
  idempotency_key: string;
  client_version: number;
  payload?: Record<string, unknown>;
  reason_code?: string;
  reason_note?: string;
};

export type ActionReasonInput = {
  reason_code: string;
  reason_note?: string;
};

export type VisitStepMutationPayload = {
  arrival_outcome?: VisitArrivalOutcome;
  reason_code?: string;
  reason_note?: string;
  evidence_key?: string;
};

export type VisitStepMutationRequest = {
  idempotency_key: string;
  client_version: number;
  payload?: VisitStepMutationPayload;
};

export type EvidenceUploadRequest = {
  idempotency_key: string;
  card_id: string;
  evidence_type: string;
  file_name: string;
  mime_type: string;
  sha256: string;
  size_bytes: number;
  s3_key?: string;
};

export type EvidencePresignUploadResponse = {
  request_id: string;
  evidence_id: string;
  s3_key: string;
  upload_url: string;
  method: 'PUT';
  headers: Record<string, string>;
  expires_in_seconds: number;
  max_size_bytes: number;
};
