'use client';

import type { Dispatch, ReactNode, SetStateAction } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, useWatch, type UseFormReturn } from 'react-hook-form';
import {
  CheckCircle2,
  FileText,
  Link2,
  PencilLine,
  RefreshCw,
  RotateCcw,
  Send,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { z } from 'zod';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DataTable } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { FormErrorSummary } from '@/components/ui/form-error-summary';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/loading';
import { Textarea } from '@/components/ui/textarea';
import { readApiJson } from '@/lib/api/client-json';
import { buildOrgHeaders } from '@/lib/api/org-headers';
import {
  apiDataSchema,
  cursorPaginatedPageSchema,
  type CursorPaginatedPage,
} from '@/lib/api/response-schemas';
import { formatDateDisplay as formatDate } from '@/lib/datetime/date-display';
import { formatYen } from '@/lib/format/currency';
import { collectFormErrorSummaryItems } from '@/lib/forms/errors';
import { useOrgId } from '@/lib/hooks/use-org-id';
import {
  partnerPharmacySummarySchema,
  pharmacyCooperationNamedEntitySchema as namedEntitySchema,
} from '@/lib/pharmacy-cooperation/api-contracts';
import { buildPartnerVisitRecordApiPath } from '@/lib/pharmacy-cooperation/navigation';
import {
  patientShareCorrectionRequestPageSchema,
  patientShareCorrectionRequestRowSchema,
  type PatientShareCorrectionRequestRow,
  type PatientShareCorrectionRequestType as CorrectionRequestType,
  type PatientShareCorrectionTargetType as CorrectionTargetType,
} from '@/lib/patient-share/correction-request-domain';
import {
  PATIENT_SHARE_CORRECTION_FIELD_OPTIONS as CORRECTION_FIELD_OPTIONS,
  PATIENT_SHARE_CORRECTION_TARGET_LABELS as CORRECTION_TARGET_LABELS,
} from '@/lib/patient-share/correction-request-labels';
import { cn } from '@/lib/utils';
import { messageFromError } from '@/lib/utils/error-message';

type PatientShareCaseRow = {
  id: string;
  status: string;
  starts_at: string | null;
  ends_at: string | null;
  updated_at: string;
  partnership: {
    id: string;
    status: string;
    partner_pharmacy: { id: string; name: string; status: string };
  };
  patient_link: {
    id: string;
    match_status: string;
    approved_by_base: string | null;
    approved_by_partner: string | null;
    accepted_at: string | null;
    declined_at: string | null;
    has_partner_patient_id: boolean;
  } | null;
};

const patientShareCaseStatuses = [
  'draft',
  'consent_pending',
  'partner_confirmation_pending',
  'active',
  'suspended',
  'revoked',
  'ended',
  'declined',
] as const;
type PatientShareCaseStatus = (typeof patientShareCaseStatuses)[number];
type PatientShareCaseStatusCounts = Record<PatientShareCaseStatus, number>;

type PatientShareCasePage = CursorPaginatedPage<PatientShareCaseRow> & {
  total_count: number;
  visible_count: number;
  hidden_count: number;
  status_counts: PatientShareCaseStatusCounts;
};

function createEmptyPatientShareCaseStatusCounts(): PatientShareCaseStatusCounts {
  return Object.fromEntries(
    patientShareCaseStatuses.map((status) => [status, 0]),
  ) as PatientShareCaseStatusCounts;
}

function buildVisiblePatientShareCaseStatusCounts(
  rows: PatientShareCaseRow[],
): PatientShareCaseStatusCounts {
  const counts = createEmptyPatientShareCaseStatusCounts();
  for (const row of rows) {
    if (patientShareCaseStatuses.includes(row.status as PatientShareCaseStatus)) {
      counts[row.status as PatientShareCaseStatus] += 1;
    }
  }
  return counts;
}

type LinkAcceptForm = {
  partnerPatientId: string;
  name: string;
  nameKana: string;
  birthDate: string;
  address: string;
  overrideReason: string;
};

type CorrectionRequestRow = PatientShareCorrectionRequestRow;

type PatientShareConsentRow = {
  id: string;
  share_case_id: string;
  consent_record_id: string | null;
  consent_date: string;
  consent_method: 'paper_scan' | 'digital';
  scope_keys: string[];
  has_file_asset: boolean;
  valid_until: string | null;
  revoked_at: string | null;
  revoked_by: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};

type CorrectionForm = {
  targetType: CorrectionTargetType;
  targetId: string;
  fieldPath: string;
  requestType: CorrectionRequestType;
  reason: string;
  proposedValue: string;
};

type PatientShareConsentForm = {
  consentDate: string;
  consentPerson: string;
  consentMethod: 'paper_scan' | 'digital';
  consentRecordId: string;
  fileAssetId: string;
  validUntil: string;
  allowPdfOutput: boolean;
  allowAttachments: boolean;
};

type VisitRequestUrgency = 'normal' | 'urgent' | 'emergency';
type VisitRequestVisitType =
  | ''
  | 'initial'
  | 'regular'
  | 'temporary'
  | 'revisit'
  | 'delivery_only'
  | 'emergency'
  | 'physician_co_visit';

type VisitRequestForm = {
  urgency: VisitRequestUrgency;
  visitType: VisitRequestVisitType;
  desiredStartAt: string;
  desiredEndAt: string;
  requestReason: string;
  physicianInstruction: string;
  carryItems: string;
  patientHomeNotes: string;
};

type VisitRequestEstimateSnapshot = {
  estimate_status?: string | null;
  billing_model?: string | null;
  unit_price?: number | null;
  tax_category?: string | null;
};

type PartnerVisitRecordDraftForm = {
  pharmacistId: string;
  pharmacistName: string;
  visitAt: string;
  medicationAdherence: string;
  remainingMedications: string;
  suspectedAdverseEffects: string;
  storageStatus: string;
  proposals: string;
  sourceVisitRecordId: string;
};

type PharmacyVisitRequestRow = {
  id: string;
  share_case_id: string;
  urgency: string;
  desired_start_at: string | null;
  desired_end_at: string | null;
  visit_type: string | null;
  status: string;
  contract_id: string | null;
  contract_version_id: string | null;
  estimated_amount: number | null;
  estimated_snapshot: VisitRequestEstimateSnapshot | null;
  accepted_at: string | null;
  declined_at: string | null;
  completed_at: string | null;
  updated_at: string;
  partner_pharmacy: { id: string; name: string; status: string };
  partnership: { id: string; base_site: { id: string; name: string } };
  has_request_reason: boolean;
  has_physician_instruction: boolean;
  has_carry_items: boolean;
  has_patient_home_notes: boolean;
  has_decline_reason: boolean;
};

type PartnerVisitRecordRow = {
  id: string;
  visit_request_id: string;
  share_case_id: string;
  revision_no: number;
  status: string;
  pharmacist_name: string | null;
  visit_at: string;
  submitted_at: string | null;
  confirmed_at: string | null;
  updated_at: string;
  owner_partner_pharmacy: { id: string; name: string; status: string };
  visit_request: { id: string; status: string; urgency: string };
  claim_note: {
    id: string;
    claim_status: string;
    visit_date: string;
    partner_pharmacy_name: string;
    prescription_received_by: string | null;
    dispensing_pharmacy_name: string | null;
  } | null;
  has_record_content: boolean;
  attachment_count: number;
  has_returned_reason: boolean;
  has_base_confirmation_snapshot: boolean;
};

type ReportDraftResult = {
  message: string;
  reused_existing_draft: boolean;
  report: { id: string; status: string; report_type: string };
};

type PendingWorkflowAction =
  | { kind: 'activateShareCase'; shareCase: PatientShareCaseRow }
  | { kind: 'baseApproveLink'; shareCase: PatientShareCaseRow }
  | { kind: 'acceptLink'; shareCase: PatientShareCaseRow; acceptForm: LinkAcceptForm }
  | { kind: 'declineLink'; shareCase: PatientShareCaseRow; declineReason: string }
  | {
      kind: 'revokePatientShareConsent';
      shareCase: PatientShareCaseRow | null;
      consent: PatientShareConsentRow;
      reason: string;
    }
  | { kind: 'acceptVisitRequest'; request: PharmacyVisitRequestRow }
  | { kind: 'declineVisitRequest'; request: PharmacyVisitRequestRow; declineReason: string }
  | { kind: 'submitPartnerVisitRecord'; record: PartnerVisitRecordRow }
  | {
      kind: 'confirmPartnerVisitRecord';
      record: PartnerVisitRecordRow;
      doctorReportRequired: boolean;
    }
  | { kind: 'returnPartnerVisitRecord'; record: PartnerVisitRecordRow; returnReason: string }
  | { kind: 'createReportDraft'; record: PartnerVisitRecordRow };

type PharmacyCooperationMessageSenderSide = 'base_pharmacy' | 'partner_pharmacy';

type PharmacyCooperationMessageRow = {
  id: string;
  org_id: string;
  thread_id: string;
  sender_user_id: string;
  sender_side: PharmacyCooperationMessageSenderSide;
  body: string;
  created_at: string;
  updated_at: string;
};

type PharmacyCooperationMessageThreadRow = {
  id: string;
  org_id: string;
  share_case_id: string;
  visit_request_id: string | null;
  context_type: 'patient_share_case' | 'visit_request';
  status: string;
  created_by: string;
  last_message_at: string | null;
  created_at: string;
  updated_at: string;
  messages: PharmacyCooperationMessageRow[];
};

const patientShareCaseRowSchema = z.object({
  id: z.string(),
  status: z.string(),
  starts_at: z.string().nullable(),
  ends_at: z.string().nullable(),
  updated_at: z.string(),
  partnership: z.object({
    id: z.string(),
    status: z.string(),
    partner_pharmacy: partnerPharmacySummarySchema,
  }),
  patient_link: z
    .object({
      id: z.string(),
      match_status: z.string(),
      approved_by_base: z.string().nullable(),
      approved_by_partner: z.string().nullable(),
      accepted_at: z.string().nullable(),
      declined_at: z.string().nullable(),
      has_partner_patient_id: z.boolean(),
    })
    .nullable(),
});

const patientShareConsentRowSchema = z.object({
  id: z.string(),
  share_case_id: z.string(),
  consent_record_id: z.string().nullable(),
  consent_date: z.string(),
  consent_method: z.enum(['paper_scan', 'digital']),
  scope_keys: z.array(z.string()),
  has_file_asset: z.boolean(),
  valid_until: z.string().nullable(),
  revoked_at: z.string().nullable(),
  revoked_by: z.string().nullable(),
  created_by: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
});

const visitRequestEstimateSnapshotSchema = z.object({
  estimate_status: z.string().nullable().optional(),
  billing_model: z.string().nullable().optional(),
  unit_price: z.number().nullable().optional(),
  tax_category: z.string().nullable().optional(),
});

const pharmacyVisitRequestRowSchema = z.object({
  id: z.string(),
  share_case_id: z.string(),
  urgency: z.string(),
  desired_start_at: z.string().nullable(),
  desired_end_at: z.string().nullable(),
  visit_type: z.string().nullable(),
  status: z.string(),
  contract_id: z.string().nullable(),
  contract_version_id: z.string().nullable(),
  estimated_amount: z.number().nullable(),
  estimated_snapshot: visitRequestEstimateSnapshotSchema.nullable(),
  accepted_at: z.string().nullable(),
  declined_at: z.string().nullable(),
  completed_at: z.string().nullable(),
  updated_at: z.string(),
  partner_pharmacy: partnerPharmacySummarySchema,
  partnership: z.object({
    id: z.string(),
    base_site: namedEntitySchema,
  }),
  has_request_reason: z.boolean(),
  has_physician_instruction: z.boolean(),
  has_carry_items: z.boolean(),
  has_patient_home_notes: z.boolean(),
  has_decline_reason: z.boolean(),
});

const partnerVisitRecordRowSchema = z.object({
  id: z.string(),
  visit_request_id: z.string(),
  share_case_id: z.string(),
  revision_no: z.number(),
  status: z.string(),
  pharmacist_name: z.string().nullable(),
  visit_at: z.string(),
  submitted_at: z.string().nullable(),
  confirmed_at: z.string().nullable(),
  updated_at: z.string(),
  owner_partner_pharmacy: partnerPharmacySummarySchema,
  visit_request: z.object({
    id: z.string(),
    status: z.string(),
    urgency: z.string(),
  }),
  claim_note: z
    .object({
      id: z.string(),
      claim_status: z.string(),
      visit_date: z.string(),
      partner_pharmacy_name: z.string(),
      prescription_received_by: z.string().nullable(),
      dispensing_pharmacy_name: z.string().nullable(),
    })
    .nullable(),
  has_record_content: z.boolean(),
  attachment_count: z.number(),
  has_returned_reason: z.boolean(),
  has_base_confirmation_snapshot: z.boolean(),
});

const pharmacyCooperationMessageRowSchema = z.object({
  id: z.string(),
  org_id: z.string(),
  thread_id: z.string(),
  sender_user_id: z.string(),
  sender_side: z.enum(['base_pharmacy', 'partner_pharmacy']),
  body: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
});

const pharmacyCooperationMessageThreadRowSchema = z.object({
  id: z.string(),
  org_id: z.string(),
  share_case_id: z.string(),
  visit_request_id: z.string().nullable(),
  context_type: z.enum(['patient_share_case', 'visit_request']),
  status: z.string(),
  created_by: z.string(),
  last_message_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  messages: z.array(pharmacyCooperationMessageRowSchema),
});

const messageThreadResultSchema = z.object({
  thread: pharmacyCooperationMessageThreadRowSchema,
  notification_count: z.number(),
});

const reportDraftResultSchema = z.object({
  message: z.string(),
  reused_existing_draft: z.boolean(),
  report: z.object({
    id: z.string(),
    status: z.string(),
    report_type: z.string(),
  }),
});

const reportDraftResponseSchema = z.object({
  data: reportDraftResultSchema,
});

const patientShareCaseStatusCountsSchema = z.object({
  draft: z.number().int().nonnegative(),
  consent_pending: z.number().int().nonnegative(),
  partner_confirmation_pending: z.number().int().nonnegative(),
  active: z.number().int().nonnegative(),
  suspended: z.number().int().nonnegative(),
  revoked: z.number().int().nonnegative(),
  ended: z.number().int().nonnegative(),
  declined: z.number().int().nonnegative(),
});

const patientShareCasePageSchema: z.ZodType<PatientShareCasePage> = z
  .object({
    data: z.array(patientShareCaseRowSchema),
    hasMore: z.boolean(),
    nextCursor: z.string().trim().min(1).optional(),
    total_count: z.number().int().nonnegative().optional(),
    visible_count: z.number().int().nonnegative().optional(),
    hidden_count: z.number().int().nonnegative().optional(),
    status_counts: patientShareCaseStatusCountsSchema.optional(),
  })
  .superRefine((value, ctx) => {
    const visibleCount = value.visible_count ?? value.data.length;
    const totalCount = value.total_count ?? visibleCount;
    const hiddenCount = value.hidden_count ?? Math.max(totalCount - visibleCount, 0);
    const statusCountTotal = value.status_counts
      ? patientShareCaseStatuses.reduce((sum, status) => sum + value.status_counts![status], 0)
      : null;

    if (value.hasMore && !value.nextCursor) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['nextCursor'],
        message: 'nextCursor is required when hasMore is true',
      });
    }
    if (visibleCount !== value.data.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['visible_count'],
        message: 'visible_count must match the returned data length',
      });
    }
    if (totalCount < visibleCount) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['total_count'],
        message: 'total_count must be greater than or equal to visible_count',
      });
    }
    if (hiddenCount !== totalCount - visibleCount) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['hidden_count'],
        message: 'hidden_count must equal total_count minus visible_count',
      });
    }
    if (hiddenCount > 0 && !value.status_counts) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['status_counts'],
        message: 'status_counts is required when hidden rows exist',
      });
    }
    if (statusCountTotal !== null && statusCountTotal !== totalCount) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['status_counts'],
        message: 'status_counts must sum to total_count',
      });
    }
  })
  .transform(
    ({ data, hasMore, nextCursor, total_count, visible_count, hidden_count, status_counts }) => ({
      data,
      hasMore,
      ...(nextCursor !== undefined ? { nextCursor } : {}),
      total_count: total_count ?? visible_count ?? data.length,
      visible_count: visible_count ?? data.length,
      hidden_count:
        hidden_count ?? Math.max((total_count ?? visible_count ?? data.length) - data.length, 0),
      status_counts: status_counts ?? buildVisiblePatientShareCaseStatusCounts(data),
    }),
  );
const pharmacyVisitRequestPageSchema = cursorPaginatedPageSchema(pharmacyVisitRequestRowSchema);
const partnerVisitRecordPageSchema = cursorPaginatedPageSchema(partnerVisitRecordRowSchema);
const partnerVisitRecordResponseSchema = z.object({
  data: partnerVisitRecordRowSchema,
});
const correctionRequestPageSchema = patientShareCorrectionRequestPageSchema;
const correctionRequestResponseSchema = apiDataSchema(
  patientShareCorrectionRequestRowSchema,
).transform(({ data }) => data);
const patientShareConsentPageSchema = z
  .object({
    data: z.array(patientShareConsentRowSchema),
    meta: z.object({
      has_more: z.boolean(),
      next_cursor: z.string().trim().min(1).nullable(),
    }),
  })
  .superRefine((value, ctx) => {
    if (value.meta.has_more && !value.meta.next_cursor) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['meta', 'next_cursor'],
        message: 'next_cursor is required when has_more is true',
      });
    }
  })
  .transform(({ data, meta }) => ({
    data,
    hasMore: meta.has_more,
    ...(meta.next_cursor ? { nextCursor: meta.next_cursor } : {}),
  }));
const patientShareConsentResponseSchema = apiDataSchema(patientShareConsentRowSchema).transform(
  ({ data }) => data,
);
const pharmacyCooperationMessageThreadPageSchema = cursorPaginatedPageSchema(
  pharmacyCooperationMessageThreadRowSchema,
);

type MessageForm = {
  body: string;
};

const EMPTY_LINK_ACCEPT_FORM: LinkAcceptForm = {
  partnerPatientId: '',
  name: '',
  nameKana: '',
  birthDate: '',
  address: '',
  overrideReason: '',
};

const EMPTY_CORRECTION_FORM: CorrectionForm = {
  targetType: 'patient_profile',
  targetId: '',
  fieldPath: CORRECTION_FIELD_OPTIONS.patient_profile[0]?.value ?? 'name',
  requestType: 'correction',
  reason: '',
  proposedValue: '',
};

const EMPTY_PATIENT_SHARE_CONSENT_FORM: PatientShareConsentForm = {
  consentDate: '',
  consentPerson: '',
  consentMethod: 'paper_scan',
  consentRecordId: '',
  fileAssetId: '',
  validUntil: '',
  allowPdfOutput: false,
  allowAttachments: false,
};

const patientShareConsentFormSchema = z.object({
  consentDate: z.string().refine((value) => value.trim().length > 0, {
    message: '同意日を入力してください',
  }),
  // The previous submit gate used trim() only for validity; preserve raw submission values.
  consentPerson: z.string().refine((value) => value.trim().length > 0, {
    message: '同意者を入力してください',
  }),
  consentMethod: z.enum(['paper_scan', 'digital']),
  consentRecordId: z.string(),
  fileAssetId: z.string(),
  validUntil: z.string(),
  allowPdfOutput: z.boolean(),
  allowAttachments: z.boolean(),
}) satisfies z.ZodType<PatientShareConsentForm>;

const VISIT_REQUEST_VISIT_TYPE_OPTIONS: Array<{
  value: Exclude<VisitRequestVisitType, ''>;
  label: string;
}> = [
  { value: 'initial', label: '初回' },
  { value: 'regular', label: '定期' },
  { value: 'temporary', label: '臨時' },
  { value: 'revisit', label: '再訪' },
  { value: 'delivery_only', label: '配達のみ' },
  { value: 'emergency', label: '緊急' },
  { value: 'physician_co_visit', label: '医師同行' },
];

const EMPTY_VISIT_REQUEST_FORM: VisitRequestForm = {
  urgency: 'normal',
  visitType: 'regular',
  desiredStartAt: '',
  desiredEndAt: '',
  requestReason: '',
  physicianInstruction: '',
  carryItems: '',
  patientHomeNotes: '',
};

const EMPTY_PARTNER_VISIT_RECORD_DRAFT_FORM: PartnerVisitRecordDraftForm = {
  pharmacistId: '',
  pharmacistName: '',
  visitAt: '',
  medicationAdherence: '',
  remainingMedications: '',
  suspectedAdverseEffects: '',
  storageStatus: '',
  proposals: '',
  sourceVisitRecordId: '',
};

const EMPTY_MESSAGE_FORM: MessageForm = {
  body: '',
};

async function fetchShareCases(orgId: string) {
  const response = await fetch(
    '/api/patient-share-cases?limit=8&view_context=pharmacy_cooperation_workflow',
    {
      headers: buildOrgHeaders(orgId),
    },
  );
  return readApiJson<PatientShareCasePage>(response, {
    fallbackMessage: '患者共有ケースの取得に失敗しました',
    schema: patientShareCasePageSchema,
  });
}

async function fetchVisitRequests(orgId: string) {
  const response = await fetch('/api/pharmacy-visit-requests?limit=8', {
    headers: buildOrgHeaders(orgId),
  });
  return readApiJson<CursorPaginatedPage<PharmacyVisitRequestRow>>(response, {
    fallbackMessage: '訪問依頼の取得に失敗しました',
    schema: pharmacyVisitRequestPageSchema,
  });
}

async function fetchPartnerVisitRecords(orgId: string) {
  const response = await fetch('/api/partner-visit-records?limit=8', {
    headers: buildOrgHeaders(orgId),
  });
  return readApiJson<CursorPaginatedPage<PartnerVisitRecordRow>>(response, {
    fallbackMessage: '協力薬局訪問記録の取得に失敗しました',
    schema: partnerVisitRecordPageSchema,
  });
}

async function fetchCorrectionRequests(orgId: string, shareCaseId: string) {
  const response = await fetch(
    `/api/patient-share-cases/${shareCaseId}/correction-requests?limit=8`,
    {
      headers: buildOrgHeaders(orgId),
    },
  );
  return readApiJson<CursorPaginatedPage<CorrectionRequestRow>>(response, {
    fallbackMessage: '修正依頼の取得に失敗しました',
    schema: correctionRequestPageSchema,
  });
}

async function fetchPatientShareConsents(orgId: string, shareCaseId: string) {
  const response = await fetch(`/api/patient-share-cases/${shareCaseId}/consents?limit=8`, {
    headers: buildOrgHeaders(orgId),
  });
  return readApiJson<CursorPaginatedPage<PatientShareConsentRow>>(response, {
    fallbackMessage: '患者共有同意の取得に失敗しました',
    schema: patientShareConsentPageSchema,
  });
}

async function fetchMessageThreads(
  orgId: string,
  shareCaseId: string,
  visitRequestId: string | null,
) {
  const params = new URLSearchParams({
    limit: '8',
    message_limit: '20',
    share_case_id: shareCaseId,
  });
  if (visitRequestId) params.set('visit_request_id', visitRequestId);

  const response = await fetch(`/api/pharmacy-cooperation-message-threads?${params.toString()}`, {
    headers: buildOrgHeaders(orgId),
  });
  return readApiJson<CursorPaginatedPage<PharmacyCooperationMessageThreadRow>>(response, {
    fallbackMessage: '連携メッセージの取得に失敗しました',
    schema: pharmacyCooperationMessageThreadPageSchema,
  });
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return '-';
  return value.slice(0, 16).replace('T', ' ');
}

function billingModelLabel(value: string | null | undefined) {
  const labels: Record<string, string> = {
    free: '無償',
    fixed_per_visit: '1訪問固定',
    per_visit_with_addon: '1訪問+加算',
    actual_cost: '実費',
    monthly_fixed: '月額固定',
    tiered_by_count: '件数段階',
    custom_quote: '個別見積',
  };
  return value ? (labels[value] ?? value) : '費用条件未確定';
}

function estimateStatusLabel(value: string | null | undefined) {
  const labels: Record<string, string> = {
    estimated: '見積済み',
    missing_active_contract: '有効契約なし',
    missing_active_contract_version: '有効契約版なし',
    missing_fee_rule: '費用条件なし',
    manual_estimate_required: '手動見積',
  };
  return value ? (labels[value] ?? value) : '見積未確定';
}

function datetimeLocalToIso(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

function multilineItems(value: string) {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function buildPartnerVisitRecordContent(form: PartnerVisitRecordDraftForm) {
  return Object.fromEntries(
    [
      ['medication_adherence', form.medicationAdherence],
      ['remaining_medications', form.remainingMedications],
      ['suspected_adverse_effects', form.suspectedAdverseEffects],
      ['storage_status', form.storageStatus],
      ['proposals', form.proposals],
    ]
      .map(([key, value]) => [key, value.trim()] as const)
      .filter(([, value]) => value.length > 0),
  );
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    draft: '下書き',
    pending: '照合待ち',
    consent_pending: '同意待ち',
    partner_confirmation_pending: '協力薬局確認待ち',
    active: '共有中',
    suspended: '停止中',
    revoked: '撤回',
    ended: '終了',
    requested: '依頼中',
    accepted: '受諾済み',
    declined: '辞退',
    scheduled: '予定済み',
    visited: '訪問済み',
    recording: '記録中',
    submitted: '提出済み',
    base_reviewing: '基幹確認中',
    confirmed: '確認済み',
    physician_report_created: '医師報告下書き済み',
    claim_checked: '請求確認済み',
    completed: '完了',
    returned: '差戻し',
    superseded: '置換済み',
    open: '未対応',
    responded: '回答済み',
    resolved: '解決',
  };
  return labels[status] ?? status;
}

function statusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (
    status === 'active' ||
    status === 'accepted' ||
    status === 'confirmed' ||
    status === 'physician_report_created' ||
    status === 'claim_checked'
  ) {
    return 'default';
  }
  if (status === 'declined' || status === 'returned' || status === 'revoked') return 'destructive';
  if (
    status === 'draft' ||
    status === 'consent_pending' ||
    status === 'partner_confirmation_pending'
  ) {
    return 'secondary';
  }
  return 'outline';
}

const correctionRequestColumns: ColumnDef<CorrectionRequestRow>[] = [
  {
    id: 'request',
    accessorFn: (row) => `${row.id} ${row.request_type === 'addition' ? '追記' : '修正'}`,
    header: '修正依頼',
    cell: ({ row }) => (
      <div>
        <div className="font-medium">{row.original.id}</div>
        <TinyMeta>{row.original.request_type === 'addition' ? '追記' : '修正'}</TinyMeta>
      </div>
    ),
    meta: { label: '修正依頼' },
  },
  {
    id: 'target',
    accessorFn: (row) =>
      `${CORRECTION_TARGET_LABELS[row.target_type] ?? row.target_type} ${row.field_path ?? '-'}`,
    header: '対象',
    cell: ({ row }) => (
      <div>
        <div>{CORRECTION_TARGET_LABELS[row.original.target_type] ?? row.original.target_type}</div>
        <TinyMeta>{row.original.field_path ?? '-'}</TinyMeta>
      </div>
    ),
    meta: { label: '対象' },
  },
  {
    id: 'status',
    accessorFn: (row) => statusLabel(row.status),
    header: '状態',
    cell: ({ row }) => (
      <Badge variant={statusVariant(row.original.status)}>{statusLabel(row.original.status)}</Badge>
    ),
    meta: { label: '状態' },
  },
  {
    id: 'updated_at',
    accessorFn: (row) => formatDateTime(row.updated_at),
    header: '更新',
    cell: ({ row }) => (
      <span className="tabular-nums">{formatDateTime(row.original.updated_at)}</span>
    ),
    meta: { label: '更新' },
  },
];

function workflowActionTitle(action: PendingWorkflowAction) {
  switch (action.kind) {
    case 'activateShareCase':
      return '患者共有ケースを共有開始します';
    case 'baseApproveLink':
      return '患者リンクを基幹承認します';
    case 'acceptLink':
      return '患者リンクを協力受諾します';
    case 'declineLink':
      return '患者リンクを辞退します';
    case 'revokePatientShareConsent':
      return '患者共有同意を撤回します';
    case 'acceptVisitRequest':
      return '訪問依頼を受諾します';
    case 'declineVisitRequest':
      return '訪問依頼を辞退します';
    case 'submitPartnerVisitRecord':
      return '協力訪問記録を提出します';
    case 'confirmPartnerVisitRecord':
      return action.doctorReportRequired
        ? '協力訪問記録を確認し報告書ドラフトを作成します'
        : '協力訪問記録を確認します';
    case 'returnPartnerVisitRecord':
      return '協力訪問記録を差戻しします';
    case 'createReportDraft':
      return '医師向け報告書ドラフトを作成します';
  }
}

function workflowActionConfirmLabel(action: PendingWorkflowAction) {
  switch (action.kind) {
    case 'activateShareCase':
      return '共有開始する';
    case 'baseApproveLink':
      return '基幹承認する';
    case 'acceptLink':
      return '協力受諾する';
    case 'declineLink':
      return '辞退する';
    case 'revokePatientShareConsent':
      return '撤回する';
    case 'acceptVisitRequest':
      return '受諾する';
    case 'declineVisitRequest':
      return '辞退する';
    case 'submitPartnerVisitRecord':
      return '提出する';
    case 'confirmPartnerVisitRecord':
      return action.doctorReportRequired ? '確認+報告する' : '確認する';
    case 'returnPartnerVisitRecord':
      return '差戻しする';
    case 'createReportDraft':
      return '報告書ドラフトを作成する';
  }
}

function workflowActionVariant(action: PendingWorkflowAction): 'default' | 'destructive' {
  return action.kind === 'declineLink' ||
    action.kind === 'revokePatientShareConsent' ||
    action.kind === 'declineVisitRequest' ||
    action.kind === 'returnPartnerVisitRecord'
    ? 'destructive'
    : 'default';
}

function workflowActionDescription(action: PendingWorkflowAction) {
  const isDestructive = workflowActionVariant(action) === 'destructive';
  return isDestructive
    ? '辞退、撤回、または差戻しの理由を確認し、対象が正しい場合のみ実行してください。'
    : 'この操作は薬局間連携の状態を更新します。対象が正しいことを確認してください。';
}

function workflowActionDetails(action: PendingWorkflowAction) {
  switch (action.kind) {
    case 'activateShareCase':
    case 'baseApproveLink':
      return [
        `共有ケース: ${action.shareCase.id}`,
        `協力薬局: ${action.shareCase.partnership.partner_pharmacy.name}`,
        `現在の共有状態: ${statusLabel(action.shareCase.status)}`,
        `患者リンク: ${statusLabel(action.shareCase.patient_link?.match_status ?? 'pending')}`,
      ];
    case 'acceptLink':
      return [
        `共有ケース: ${action.shareCase.id}`,
        `協力薬局: ${action.shareCase.partnership.partner_pharmacy.name}`,
        `協力側ID: ${action.acceptForm.partnerPatientId}`,
        `照合補足: ${action.acceptForm.overrideReason.trim() ? '入力済み' : '未入力'}`,
      ];
    case 'declineLink':
      return [
        `共有ケース: ${action.shareCase.id}`,
        `協力薬局: ${action.shareCase.partnership.partner_pharmacy.name}`,
        `辞退理由: 入力済み (${action.declineReason.trim().length}文字)`,
      ];
    case 'revokePatientShareConsent':
      return [
        `共有ケース: ${action.consent.share_case_id}`,
        `協力薬局: ${action.shareCase?.partnership.partner_pharmacy.name ?? '不明'}`,
        `同意: ${action.consent.id}`,
        `同意日: ${formatDate(action.consent.consent_date)}`,
        `撤回理由: 入力済み (${action.reason.trim().length}文字)`,
      ];
    case 'acceptVisitRequest':
      return [
        `訪問依頼: ${action.request.id}`,
        `協力薬局: ${action.request.partner_pharmacy.name}`,
        `希望日時: ${formatDateTime(action.request.desired_start_at)}`,
        `見込額: ${formatYen(action.request.estimated_amount)}`,
      ];
    case 'declineVisitRequest':
      return [
        `訪問依頼: ${action.request.id}`,
        `協力薬局: ${action.request.partner_pharmacy.name}`,
        `辞退理由: 入力済み (${action.declineReason.trim().length}文字)`,
      ];
    case 'submitPartnerVisitRecord':
      return [
        `訪問記録: ${action.record.id}`,
        `協力薬局: ${action.record.owner_partner_pharmacy.name}`,
        `訪問日時: ${formatDateTime(action.record.visit_at)}`,
        `版: rev.${action.record.revision_no}`,
      ];
    case 'confirmPartnerVisitRecord':
      return [
        `訪問記録: ${action.record.id}`,
        `協力薬局: ${action.record.owner_partner_pharmacy.name}`,
        `訪問日時: ${formatDateTime(action.record.visit_at)}`,
        action.doctorReportRequired
          ? '医師向け報告書ドラフト: 作成する'
          : '医師向け報告書ドラフト: 作成しない',
      ];
    case 'returnPartnerVisitRecord':
      return [
        `訪問記録: ${action.record.id}`,
        `協力薬局: ${action.record.owner_partner_pharmacy.name}`,
        `差戻し理由: 入力済み (${action.returnReason.trim().length}文字)`,
      ];
    case 'createReportDraft':
      return [
        `訪問記録: ${action.record.id}`,
        `協力薬局: ${action.record.owner_partner_pharmacy.name}`,
        `訪問日時: ${formatDateTime(action.record.visit_at)}`,
        `現在の状態: ${statusLabel(action.record.status)}`,
      ];
  }
}

function messageSenderSideLabel(senderSide: PharmacyCooperationMessageSenderSide) {
  return senderSide === 'base_pharmacy' ? '基幹薬局' : '協力薬局';
}

function messageContextLabel(thread: PharmacyCooperationMessageThreadRow) {
  return thread.visit_request_id ? `訪問依頼 ${thread.visit_request_id}` : '患者共有ケース全体';
}

function TinyMeta({ children }: { children: ReactNode }) {
  return <span className="text-xs text-muted-foreground">{children}</span>;
}

function FieldLabel({ children }: { children: ReactNode }) {
  return <span className="text-xs font-medium text-muted-foreground">{children}</span>;
}

function NativeSelect({
  value,
  onChange,
  children,
  disabled,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
  disabled?: boolean;
  ariaLabel: string;
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      disabled={disabled}
      aria-label={ariaLabel}
      className="h-11 min-h-11 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </select>
  );
}

function SectionShell({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border/70 bg-card p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-bold text-foreground">{title}</h2>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

function QueryFallback({
  isLoading,
  isError,
  error,
  onRetry,
  children,
}: {
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
  children: ReactNode;
}) {
  const fallbackDetail =
    error instanceof Error
      ? '詳細は内部ログで確認できます。再試行しても解消しない場合は管理者へ連絡してください。'
      : '通信状態を確認してから再試行してください。';

  if (isLoading) return <Skeleton className="h-60 rounded-lg" />;
  if (isError) {
    return (
      <ErrorState
        variant="server"
        title="薬局間協力ワークフローを表示できません"
        description="状態一覧の取得に失敗しました。再試行してください。"
        detail={fallbackDetail}
        onRetry={onRetry}
      />
    );
  }
  return <>{children}</>;
}

function PatientShareConsentSummaryCell({ consent }: { consent: PatientShareConsentRow }) {
  return (
    <div>
      <div className="font-medium">{consent.id}</div>
      <TinyMeta>
        {formatDate(consent.consent_date)} /{' '}
        {consent.consent_method === 'digital' ? 'デジタル' : '紙署名'}
      </TinyMeta>
    </div>
  );
}

function PatientShareConsentStatusCell({ consent }: { consent: PatientShareConsentRow }) {
  return (
    <div>
      <Badge variant={consent.revoked_at ? 'destructive' : 'default'}>
        {consent.revoked_at ? '撤回済み' : '有効'}
      </Badge>
      <div className="mt-1">
        <TinyMeta>{consent.has_file_asset ? '添付あり' : '添付なし'}</TinyMeta>
      </div>
    </div>
  );
}

function PatientShareConsentScopeCell({ consent }: { consent: PatientShareConsentRow }) {
  return <TinyMeta>{consent.scope_keys.length > 0 ? consent.scope_keys.join(', ') : '-'}</TinyMeta>;
}

function PatientShareConsentActionCell({
  consent,
  revokeReason,
  setRevokeReasons,
  isBusy,
  onRevoke,
}: {
  consent: PatientShareConsentRow;
  revokeReason: string;
  setRevokeReasons: Dispatch<SetStateAction<Record<string, string>>>;
  isBusy: boolean;
  onRevoke: (consent: PatientShareConsentRow, reason: string) => void;
}) {
  const canRevoke = !isBusy && revokeReason.trim().length > 0;

  if (consent.revoked_at) {
    return <TinyMeta>状態遷移はありません</TinyMeta>;
  }

  return (
    <div className="flex min-w-64 flex-col gap-2">
      <Input
        value={revokeReason}
        onChange={(event) =>
          setRevokeReasons((current) => ({
            ...current,
            [consent.id]: event.target.value,
          }))
        }
        placeholder="撤回理由"
        aria-label={`${consent.id} の患者共有同意撤回理由`}
      />
      <Button
        type="button"
        size="sm"
        variant="destructive"
        disabled={!canRevoke}
        onClick={() => onRevoke(consent, revokeReason)}
        aria-label={`${consent.id} の患者共有同意を撤回`}
      >
        <XCircle className="size-4" aria-hidden="true" />
        撤回
      </Button>
    </div>
  );
}

function VisitRequestSummaryCell({ request }: { request: PharmacyVisitRequestRow }) {
  return (
    <div>
      <div className="font-medium">{request.id}</div>
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        <Badge variant={statusVariant(request.status)}>{statusLabel(request.status)}</Badge>
        <TinyMeta>{request.urgency}</TinyMeta>
      </div>
    </div>
  );
}

function VisitRequestDesiredTimeCell({ request }: { request: PharmacyVisitRequestRow }) {
  return (
    <span className="tabular-nums">
      {formatDateTime(request.desired_start_at)}
      {request.desired_end_at ? ` - ${formatDateTime(request.desired_end_at)}` : ''}
    </span>
  );
}

function VisitRequestEstimateCell({ request }: { request: PharmacyVisitRequestRow }) {
  return (
    <div className="text-right tabular-nums">
      {formatYen(request.estimated_amount)}
      <div className="mt-1">
        <TinyMeta>
          {request.contract_id ? `契約 ${request.contract_id}` : '契約未確定'}
          {request.contract_version_id ? ` / 版 ${request.contract_version_id}` : ''}
        </TinyMeta>
      </div>
      <div className="mt-1">
        <TinyMeta>
          {billingModelLabel(request.estimated_snapshot?.billing_model)}
          {request.estimated_snapshot?.unit_price !== null &&
          request.estimated_snapshot?.unit_price !== undefined
            ? ` / 単価 ${formatYen(request.estimated_snapshot.unit_price)}`
            : ''}
        </TinyMeta>
      </div>
      <div className="mt-1">
        <TinyMeta>{estimateStatusLabel(request.estimated_snapshot?.estimate_status)}</TinyMeta>
      </div>
    </div>
  );
}

function VisitRequestActionCell({
  request,
  declineReason,
  setDeclineReasons,
  isBusy,
  onAccept,
  onDecline,
}: {
  request: PharmacyVisitRequestRow;
  declineReason: string;
  setDeclineReasons: Dispatch<SetStateAction<Record<string, string>>>;
  isBusy: boolean;
  onAccept: (row: PharmacyVisitRequestRow) => void;
  onDecline: (row: PharmacyVisitRequestRow, reason: string) => void;
}) {
  const partnerPharmacyName = request.partner_pharmacy.name;

  if (request.status !== 'requested') {
    return <TinyMeta>状態遷移はありません</TinyMeta>;
  }

  return (
    <div className="flex min-w-0 flex-col gap-2 text-left md:min-w-72">
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          disabled={isBusy}
          onClick={() => onAccept(request)}
          aria-label={`${request.id} ${partnerPharmacyName} の訪問依頼を受諾`}
        >
          <CheckCircle2 className="size-4" aria-hidden="true" />
          受諾
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={isBusy || declineReason.trim().length === 0}
          onClick={() => onDecline(request, declineReason)}
          aria-label={`${request.id} ${partnerPharmacyName} の訪問依頼を辞退`}
        >
          <XCircle className="size-4" aria-hidden="true" />
          辞退
        </Button>
      </div>
      <Input
        value={declineReason}
        onChange={(event) =>
          setDeclineReasons((current) => ({
            ...current,
            [request.id]: event.target.value,
          }))
        }
        placeholder="辞退理由"
        aria-label={`${request.id} の辞退理由`}
      />
    </div>
  );
}

function PartnerVisitRecordSummaryCell({ record }: { record: PartnerVisitRecordRow }) {
  return (
    <div>
      <div className="font-medium">{record.id}</div>
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        <Badge variant={statusVariant(record.status)}>{statusLabel(record.status)}</Badge>
        <TinyMeta>rev.{record.revision_no}</TinyMeta>
      </div>
    </div>
  );
}

function PartnerVisitRecordClaimNoteCell({ record }: { record: PartnerVisitRecordRow }) {
  if (!record.claim_note) {
    return <TinyMeta>未作成</TinyMeta>;
  }

  return (
    <div>
      <div>{statusLabel(record.claim_note.claim_status)}</div>
      <TinyMeta>{formatDate(record.claim_note.visit_date)}</TinyMeta>
    </div>
  );
}

function PartnerVisitRecordActionCell({
  record,
  returnReason,
  setReturnReasons,
  isBusy,
  onSubmit,
  onConfirm,
  onReturn,
  onCreateReport,
}: {
  record: PartnerVisitRecordRow;
  returnReason: string;
  setReturnReasons: Dispatch<SetStateAction<Record<string, string>>>;
  isBusy: boolean;
  onSubmit: (row: PartnerVisitRecordRow) => void;
  onConfirm: (row: PartnerVisitRecordRow, doctorReportRequired: boolean) => void;
  onReturn: (row: PartnerVisitRecordRow, reason: string) => void;
  onCreateReport: (row: PartnerVisitRecordRow) => void;
}) {
  const ownerPartnerPharmacyName = record.owner_partner_pharmacy.name;

  if (record.status === 'draft' || record.status === 'returned') {
    return (
      <Button
        type="button"
        size="sm"
        disabled={isBusy}
        onClick={() => onSubmit(record)}
        aria-label={`${record.id} ${ownerPartnerPharmacyName} の協力訪問記録を提出`}
      >
        <Send className="size-4" aria-hidden="true" />
        提出
      </Button>
    );
  }

  if (record.status === 'submitted') {
    return (
      <div className="flex min-w-0 flex-col gap-2 text-left md:min-w-[24rem]">
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            disabled={isBusy}
            onClick={() => onConfirm(record, false)}
            aria-label={`${record.id} ${ownerPartnerPharmacyName} の協力訪問記録を確認`}
          >
            <CheckCircle2 className="size-4" aria-hidden="true" />
            確認
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={isBusy}
            onClick={() => onConfirm(record, true)}
            aria-label={`${record.id} ${ownerPartnerPharmacyName} の協力訪問記録を確認して報告書ドラフトを作成`}
          >
            <FileText className="size-4" aria-hidden="true" />
            確認+報告
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={isBusy || returnReason.trim().length === 0}
            onClick={() => onReturn(record, returnReason)}
            aria-label={`${record.id} ${ownerPartnerPharmacyName} の協力訪問記録を差戻し`}
          >
            <RotateCcw className="size-4" aria-hidden="true" />
            差戻し
          </Button>
        </div>
        <Input
          value={returnReason}
          onChange={(event) =>
            setReturnReasons((current) => ({
              ...current,
              [record.id]: event.target.value,
            }))
          }
          placeholder="差戻し理由"
          aria-label={`${record.id} の差戻し理由`}
        />
      </div>
    );
  }

  if (record.status === 'confirmed') {
    return (
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={isBusy}
        onClick={() => onCreateReport(record)}
        aria-label={`${record.id} ${ownerPartnerPharmacyName} の報告書ドラフトを作成`}
      >
        <FileText className="size-4" aria-hidden="true" />
        報告書ドラフト
      </Button>
    );
  }

  return <TinyMeta>状態遷移はありません</TinyMeta>;
}

function ShareCasesTable({
  rows,
  linkAcceptForms,
  setLinkAcceptForms,
  linkDeclineReasons,
  setLinkDeclineReasons,
  isBusy,
  onActivate,
  onBaseApprove,
  onAcceptLink,
  onDeclineLink,
  onSelectCorrectionCase,
}: {
  rows: PatientShareCaseRow[];
  linkAcceptForms: Record<string, LinkAcceptForm>;
  setLinkAcceptForms: Dispatch<SetStateAction<Record<string, LinkAcceptForm>>>;
  linkDeclineReasons: Record<string, string>;
  setLinkDeclineReasons: Dispatch<SetStateAction<Record<string, string>>>;
  isBusy: boolean;
  onActivate: (row: PatientShareCaseRow) => void;
  onBaseApprove: (row: PatientShareCaseRow) => void;
  onAcceptLink: (row: PatientShareCaseRow, form: LinkAcceptForm) => void;
  onDeclineLink: (row: PatientShareCaseRow, reason: string) => void;
  onSelectCorrectionCase: (id: string) => void;
}) {
  if (rows.length === 0) {
    return <EmptyState title="患者共有ケースはまだありません" />;
  }

  const updateAcceptForm = (
    id: string,
    patch: Partial<LinkAcceptForm>,
    currentForm: LinkAcceptForm,
  ) => {
    setLinkAcceptForms((current) => ({
      ...current,
      [id]: { ...currentForm, ...patch },
    }));
  };

  const shareCaseColumns: ColumnDef<PatientShareCaseRow>[] = [
    {
      id: 'share_case',
      header: '共有ケース',
      meta: { label: '共有ケース' },
      cell: ({ row }) => (
        <div>
          <div className="font-medium">{row.original.id}</div>
          <Badge className="mt-1" variant={statusVariant(row.original.status)}>
            {statusLabel(row.original.status)}
          </Badge>
        </div>
      ),
      enableSorting: false,
    },
    {
      id: 'partner_pharmacy',
      header: '協力薬局',
      meta: { label: '協力薬局' },
      cell: ({ row }) => row.original.partnership.partner_pharmacy.name,
      enableSorting: false,
    },
    {
      id: 'patient_link',
      header: '患者リンク',
      meta: { label: '患者リンク' },
      cell: ({ row }) => {
        const link = row.original.patient_link;
        const baseApproved = Boolean(link?.approved_by_base);
        return (
          <div>
            <div>{statusLabel(link?.match_status ?? 'pending')}</div>
            <TinyMeta>
              base {baseApproved ? '承認済み' : '未承認'} / partner{' '}
              {link?.approved_by_partner ? '承認済み' : '未承認'}
            </TinyMeta>
          </div>
        );
      },
      enableSorting: false,
    },
    {
      id: 'valid_period',
      header: '有効期間',
      meta: { label: '有効期間' },
      cell: ({ row }) => (
        <span className="tabular-nums">
          {formatDate(row.original.starts_at)} - {formatDate(row.original.ends_at)}
        </span>
      ),
      enableSorting: false,
    },
    {
      id: 'action',
      header: '操作',
      meta: { label: '操作' },
      cell: ({ row }) => {
        const shareCase = row.original;
        return (
          <ShareCaseActionCell
            row={shareCase}
            acceptForm={linkAcceptForms[shareCase.id] ?? EMPTY_LINK_ACCEPT_FORM}
            declineReason={linkDeclineReasons[shareCase.id] ?? ''}
            updateAcceptForm={updateAcceptForm}
            setLinkDeclineReasons={setLinkDeclineReasons}
            isBusy={isBusy}
            onActivate={onActivate}
            onBaseApprove={onBaseApprove}
            onAcceptLink={onAcceptLink}
            onDeclineLink={onDeclineLink}
            onSelectCorrectionCase={onSelectCorrectionCase}
          />
        );
      },
      enableSorting: false,
    },
  ];

  return (
    <DataTable
      columns={shareCaseColumns}
      data={rows}
      caption="患者共有ケース一覧"
      getRowId={(row) => row.id}
      getRowA11yLabel={(row) =>
        `${row.id} ${row.partnership.partner_pharmacy.name} ${statusLabel(row.status)}`
      }
      emptyMessage="患者共有ケースはまだありません"
    />
  );
}

function ShareCaseActionCell({
  row,
  acceptForm,
  declineReason,
  updateAcceptForm,
  setLinkDeclineReasons,
  isBusy,
  onActivate,
  onBaseApprove,
  onAcceptLink,
  onDeclineLink,
  onSelectCorrectionCase,
}: {
  row: PatientShareCaseRow;
  acceptForm: LinkAcceptForm;
  declineReason: string;
  updateAcceptForm: (
    id: string,
    patch: Partial<LinkAcceptForm>,
    currentForm: LinkAcceptForm,
  ) => void;
  setLinkDeclineReasons: Dispatch<SetStateAction<Record<string, string>>>;
  isBusy: boolean;
  onActivate: (row: PatientShareCaseRow) => void;
  onBaseApprove: (row: PatientShareCaseRow) => void;
  onAcceptLink: (row: PatientShareCaseRow, form: LinkAcceptForm) => void;
  onDeclineLink: (row: PatientShareCaseRow, reason: string) => void;
  onSelectCorrectionCase: (id: string) => void;
}) {
  const link = row.patient_link;
  const partnerPharmacyName = row.partnership.partner_pharmacy.name;
  const isPendingLink = link?.match_status === 'pending';
  const baseApproved = Boolean(link?.approved_by_base);
  const partnerAccepted = link?.match_status === 'accepted';
  const canAccept =
    isPendingLink &&
    baseApproved &&
    acceptForm.partnerPatientId.trim().length > 0 &&
    acceptForm.name.trim().length > 0 &&
    acceptForm.birthDate.trim().length > 0;
  const canActivate = row.status !== 'active' && partnerAccepted;

  return (
    <div className="flex flex-col gap-3 text-left">
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={isBusy || !canActivate}
          onClick={() => onActivate(row)}
          aria-label={`${row.id} ${partnerPharmacyName} を共有開始`}
        >
          <CheckCircle2 className="size-4" aria-hidden="true" />
          共有開始
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={isBusy || !isPendingLink || baseApproved}
          onClick={() => onBaseApprove(row)}
          aria-label={`${row.id} ${partnerPharmacyName} の患者リンクを基幹承認`}
        >
          <Link2 className="size-4" aria-hidden="true" />
          基幹承認
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={isBusy}
          onClick={() => onSelectCorrectionCase(row.id)}
          aria-label={`${row.id} ${partnerPharmacyName} の修正依頼対象にする`}
        >
          <PencilLine className="size-4" aria-hidden="true" />
          修正依頼
        </Button>
      </div>

      {isPendingLink ? (
        <div className="grid gap-2 rounded-md border border-border/60 bg-muted/30 p-3 sm:grid-cols-2 xl:grid-cols-3">
          <label className="flex flex-col gap-1">
            <FieldLabel>協力側ID</FieldLabel>
            <Input
              value={acceptForm.partnerPatientId}
              onChange={(event) =>
                updateAcceptForm(row.id, { partnerPatientId: event.target.value }, acceptForm)
              }
              aria-label={`${row.id} の協力側ID`}
            />
          </label>
          <label className="flex flex-col gap-1">
            <FieldLabel>氏名</FieldLabel>
            <Input
              value={acceptForm.name}
              onChange={(event) =>
                updateAcceptForm(row.id, { name: event.target.value }, acceptForm)
              }
              aria-label={`${row.id} の協力側氏名`}
            />
          </label>
          <label className="flex flex-col gap-1">
            <FieldLabel>氏名カナ</FieldLabel>
            <Input
              value={acceptForm.nameKana}
              onChange={(event) =>
                updateAcceptForm(row.id, { nameKana: event.target.value }, acceptForm)
              }
              aria-label={`${row.id} の協力側氏名カナ`}
            />
          </label>
          <label className="flex flex-col gap-1">
            <FieldLabel>生年月日</FieldLabel>
            <Input
              type="date"
              value={acceptForm.birthDate}
              onChange={(event) =>
                updateAcceptForm(row.id, { birthDate: event.target.value }, acceptForm)
              }
              aria-label={`${row.id} の協力側生年月日`}
            />
          </label>
          <label className="flex flex-col gap-1">
            <FieldLabel>住所</FieldLabel>
            <Input
              value={acceptForm.address}
              onChange={(event) =>
                updateAcceptForm(row.id, { address: event.target.value }, acceptForm)
              }
              aria-label={`${row.id} の協力側住所`}
            />
          </label>
          <label className="flex flex-col gap-1">
            <FieldLabel>照合補足</FieldLabel>
            <Input
              value={acceptForm.overrideReason}
              onChange={(event) =>
                updateAcceptForm(row.id, { overrideReason: event.target.value }, acceptForm)
              }
              aria-label={`${row.id} の照合補足`}
            />
          </label>
          <div className="flex flex-wrap gap-2 sm:col-span-2 xl:col-span-3">
            <Button
              type="button"
              size="sm"
              disabled={isBusy || !canAccept}
              onClick={() => onAcceptLink(row, acceptForm)}
              aria-label={`${row.id} ${partnerPharmacyName} の患者リンクを協力受諾`}
            >
              <CheckCircle2 className="size-4" aria-hidden="true" />
              協力受諾
            </Button>
            <Input
              value={declineReason}
              onChange={(event) =>
                setLinkDeclineReasons((current) => ({
                  ...current,
                  [row.id]: event.target.value,
                }))
              }
              placeholder="辞退理由"
              aria-label={`${row.id} の患者リンク辞退理由`}
              className="min-w-0 flex-1 lg:min-w-52"
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={isBusy || declineReason.trim().length === 0}
              onClick={() => onDeclineLink(row, declineReason)}
              aria-label={`${row.id} ${partnerPharmacyName} の患者リンクを辞退`}
            >
              <XCircle className="size-4" aria-hidden="true" />
              辞退
            </Button>
          </div>
        </div>
      ) : (
        <TinyMeta>患者リンクの状態遷移はありません</TinyMeta>
      )}
    </div>
  );
}

function PatientShareConsentsPanel({
  shareCases,
  selectedShareCaseId,
  setSelectedShareCaseId,
  consents,
  formMethods,
  revokeReasons,
  setRevokeReasons,
  isLoading,
  isError,
  error,
  isBusy,
  onRetry,
  onCreate,
  onRevoke,
}: {
  shareCases: PatientShareCaseRow[];
  selectedShareCaseId: string;
  setSelectedShareCaseId: (id: string) => void;
  consents: PatientShareConsentRow[];
  formMethods: UseFormReturn<PatientShareConsentForm>;
  revokeReasons: Record<string, string>;
  setRevokeReasons: Dispatch<SetStateAction<Record<string, string>>>;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  isBusy: boolean;
  onRetry: () => void;
  onCreate: () => void;
  onRevoke: (consent: PatientShareConsentRow, reason: string) => void;
}) {
  const watchedForm = useWatch({ control: formMethods.control });
  const form: PatientShareConsentForm = {
    ...EMPTY_PATIENT_SHARE_CONSENT_FORM,
    ...watchedForm,
  };
  const selectedShareCase = shareCases.find((row) => row.id === selectedShareCaseId) ?? null;
  const errorSummaryId = 'patient-share-consent-error-summary';
  const {
    formState: { errors },
  } = formMethods;
  const errorSummaryItems = collectFormErrorSummaryItems(errors, {
    consentDate: '同意日',
    consentPerson: '同意者',
    consentMethod: '方法',
    consentRecordId: '同意記録ID',
    fileAssetId: '添付ID',
    validUntil: '有効期限',
    allowPdfOutput: 'PDF出力',
    allowAttachments: '添付閲覧',
  });
  function focusErrorSummary() {
    if (typeof document === 'undefined') return;
    document.getElementById(errorSummaryId)?.focus();
  }

  const canCreate =
    Boolean(selectedShareCaseId) &&
    Boolean(selectedShareCase) &&
    selectedShareCase?.status !== 'ended' &&
    selectedShareCase?.status !== 'revoked' &&
    selectedShareCase?.status !== 'declined' &&
    form.consentDate.trim().length > 0 &&
    form.consentPerson.trim().length > 0;
  const consentColumns: ColumnDef<PatientShareConsentRow>[] = [
    {
      id: 'consent',
      header: '同意',
      meta: { label: '同意' },
      cell: ({ row }) => <PatientShareConsentSummaryCell consent={row.original} />,
      enableSorting: false,
    },
    {
      id: 'status',
      header: '状態',
      meta: { label: '状態' },
      cell: ({ row }) => <PatientShareConsentStatusCell consent={row.original} />,
      enableSorting: false,
    },
    {
      id: 'scope',
      header: '範囲',
      meta: { label: '範囲' },
      cell: ({ row }) => <PatientShareConsentScopeCell consent={row.original} />,
      enableSorting: false,
    },
    {
      id: 'action',
      header: '操作',
      meta: { label: '操作' },
      cell: ({ row }) => (
        <PatientShareConsentActionCell
          consent={row.original}
          revokeReason={revokeReasons[row.original.id] ?? ''}
          setRevokeReasons={setRevokeReasons}
          isBusy={isBusy}
          onRevoke={onRevoke}
        />
      ),
      enableSorting: false,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="grid gap-3 rounded-md border border-border/60 bg-muted/30 p-3 lg:grid-cols-[minmax(12rem,18rem)_1fr]">
        <label className="flex flex-col gap-1">
          <FieldLabel>共有ケース</FieldLabel>
          <NativeSelect
            value={selectedShareCaseId}
            onChange={setSelectedShareCaseId}
            disabled={shareCases.length === 0}
            ariaLabel="同意管理の共有ケース"
          >
            {shareCases.length === 0 ? <option value="">未選択</option> : null}
            {shareCases.map((row) => (
              <option key={row.id} value={row.id}>
                {row.id} / {statusLabel(row.status)}
              </option>
            ))}
          </NativeSelect>
        </label>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {errorSummaryItems.length > 0 ? (
            <div className="sm:col-span-2 xl:col-span-3">
              <FormErrorSummary id={errorSummaryId} items={errorSummaryItems} />
            </div>
          ) : null}
          <label className="flex flex-col gap-1">
            <FieldLabel>同意日</FieldLabel>
            <Input
              type="date"
              {...formMethods.register('consentDate')}
              aria-label="患者共有同意日"
              aria-invalid={!!errors.consentDate}
            />
          </label>
          <label className="flex flex-col gap-1">
            <FieldLabel>同意者</FieldLabel>
            <Input
              {...formMethods.register('consentPerson')}
              aria-label="患者共有同意者"
              aria-invalid={!!errors.consentPerson}
            />
          </label>
          <label className="flex flex-col gap-1">
            <FieldLabel>方法</FieldLabel>
            <NativeSelect
              value={form.consentMethod}
              onChange={(value) =>
                formMethods.setValue(
                  'consentMethod',
                  value as PatientShareConsentForm['consentMethod'],
                  { shouldDirty: true },
                )
              }
              ariaLabel="患者共有同意方法"
            >
              <option value="paper_scan">紙署名</option>
              <option value="digital">デジタル</option>
            </NativeSelect>
          </label>
          <label className="flex flex-col gap-1">
            <FieldLabel>同意記録ID</FieldLabel>
            <Input
              {...formMethods.register('consentRecordId')}
              aria-label="患者共有同意記録ID"
              aria-invalid={!!errors.consentRecordId}
            />
          </label>
          <label className="flex flex-col gap-1">
            <FieldLabel>添付ID</FieldLabel>
            <Input
              {...formMethods.register('fileAssetId')}
              aria-label="患者共有同意添付ID"
              aria-invalid={!!errors.fileAssetId}
            />
          </label>
          <label className="flex flex-col gap-1">
            <FieldLabel>有効期限</FieldLabel>
            <Input
              type="date"
              {...formMethods.register('validUntil')}
              aria-label="患者共有同意有効期限"
              aria-invalid={!!errors.validUntil}
            />
          </label>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              {...formMethods.register('allowPdfOutput')}
              aria-label="患者共有同意PDF出力"
              className="size-5 rounded border-border"
            />
            PDF出力
          </label>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              {...formMethods.register('allowAttachments')}
              aria-label="患者共有同意添付閲覧"
              className="size-5 rounded border-border"
            />
            添付閲覧
          </label>
        </div>
        <div className="lg:col-span-2">
          <Button
            type="button"
            disabled={isBusy || !canCreate}
            onClick={formMethods.handleSubmit(() => onCreate(), focusErrorSummary)}
          >
            <CheckCircle2 className="size-4" aria-hidden="true" />
            同意登録
          </Button>
        </div>
      </div>

      <QueryFallback isLoading={isLoading} isError={isError} error={error} onRetry={onRetry}>
        {consents.length === 0 ? (
          <EmptyState title="患者共有同意はまだありません" />
        ) : (
          <DataTable
            columns={consentColumns}
            data={consents}
            caption="患者共有同意一覧"
            getRowId={(row) => row.id}
            getRowA11yLabel={(row) =>
              `${row.id} ${row.revoked_at ? '撤回済み' : '有効'} ${
                row.scope_keys.length > 0 ? row.scope_keys.join(', ') : '-'
              }`
            }
            emptyMessage="患者共有同意はまだありません"
          />
        )}
      </QueryFallback>
    </div>
  );
}

function VisitRequestsTable({
  rows,
  declineReasons,
  setDeclineReasons,
  isBusy,
  onAccept,
  onDecline,
}: {
  rows: PharmacyVisitRequestRow[];
  declineReasons: Record<string, string>;
  setDeclineReasons: Dispatch<SetStateAction<Record<string, string>>>;
  isBusy: boolean;
  onAccept: (row: PharmacyVisitRequestRow) => void;
  onDecline: (row: PharmacyVisitRequestRow, reason: string) => void;
}) {
  if (rows.length === 0) {
    return <EmptyState title="協力薬局への訪問依頼はまだありません" />;
  }
  const visitRequestColumns: ColumnDef<PharmacyVisitRequestRow>[] = [
    {
      id: 'request',
      header: '依頼',
      meta: { label: '依頼' },
      cell: ({ row }) => <VisitRequestSummaryCell request={row.original} />,
      enableSorting: false,
    },
    {
      id: 'partner_pharmacy',
      header: '協力薬局',
      meta: { label: '協力薬局' },
      cell: ({ row }) => row.original.partner_pharmacy.name,
      enableSorting: false,
    },
    {
      id: 'desired_time',
      header: '希望日時',
      meta: { label: '希望日時' },
      cell: ({ row }) => <VisitRequestDesiredTimeCell request={row.original} />,
      enableSorting: false,
    },
    {
      id: 'estimate',
      header: '見込額',
      meta: { label: '見込額' },
      cell: ({ row }) => <VisitRequestEstimateCell request={row.original} />,
      enableSorting: false,
    },
    {
      id: 'action',
      header: '操作',
      meta: { label: '操作' },
      cell: ({ row }) => (
        <VisitRequestActionCell
          request={row.original}
          declineReason={declineReasons[row.original.id] ?? ''}
          setDeclineReasons={setDeclineReasons}
          isBusy={isBusy}
          onAccept={onAccept}
          onDecline={onDecline}
        />
      ),
      enableSorting: false,
    },
  ];

  return (
    <DataTable
      columns={visitRequestColumns}
      data={rows}
      caption="協力薬局訪問依頼一覧"
      getRowId={(row) => row.id}
      getRowA11yLabel={(row) => `${row.id} ${row.partner_pharmacy.name} ${statusLabel(row.status)}`}
      emptyMessage="協力薬局への訪問依頼はまだありません"
    />
  );
}

function VisitRequestCreatePanel({
  activeShareCases,
  activeShareCaseTotalCount,
  selectedShareCaseId,
  setSelectedShareCaseId,
  form,
  setForm,
  isBusy,
  onCreate,
}: {
  activeShareCases: PatientShareCaseRow[];
  activeShareCaseTotalCount: number;
  selectedShareCaseId: string;
  setSelectedShareCaseId: (id: string) => void;
  form: VisitRequestForm;
  setForm: Dispatch<SetStateAction<VisitRequestForm>>;
  isBusy: boolean;
  onCreate: () => void;
}) {
  const selectedShareCase = activeShareCases.find((row) => row.id === selectedShareCaseId) ?? null;
  const hasOrderedWindow =
    !form.desiredStartAt.trim() ||
    !form.desiredEndAt.trim() ||
    form.desiredEndAt > form.desiredStartAt;
  const canCreate =
    Boolean(selectedShareCase) &&
    hasOrderedWindow &&
    form.desiredStartAt.trim().length > 0 &&
    form.requestReason.trim().length > 0;

  return (
    <div className="mb-4 rounded-md border border-border/60 bg-muted/30 p-3">
      <div className="grid gap-3 lg:grid-cols-[minmax(12rem,18rem)_1fr]">
        <label className="flex flex-col gap-1">
          <FieldLabel>共有ケース</FieldLabel>
          <NativeSelect
            value={selectedShareCaseId}
            onChange={setSelectedShareCaseId}
            disabled={activeShareCases.length === 0}
            ariaLabel="訪問依頼作成の共有ケース"
          >
            {activeShareCases.length === 0 ? <option value="">未選択</option> : null}
            {activeShareCases.map((row) => (
              <option key={row.id} value={row.id}>
                {row.id} / {row.partnership.partner_pharmacy.name}
              </option>
            ))}
          </NativeSelect>
          {activeShareCases.length === 0 && activeShareCaseTotalCount > 0 ? (
            <TinyMeta>共有中の患者共有ケースは未表示です</TinyMeta>
          ) : null}
        </label>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <label className="flex flex-col gap-1">
            <FieldLabel>緊急度</FieldLabel>
            <NativeSelect
              value={form.urgency}
              onChange={(value) =>
                setForm((current) => ({ ...current, urgency: value as VisitRequestUrgency }))
              }
              ariaLabel="訪問依頼の緊急度"
            >
              <option value="normal">通常</option>
              <option value="urgent">急ぎ</option>
              <option value="emergency">緊急</option>
            </NativeSelect>
          </label>
          <label className="flex flex-col gap-1">
            <FieldLabel>訪問区分</FieldLabel>
            <NativeSelect
              value={form.visitType}
              onChange={(value) =>
                setForm((current) => ({
                  ...current,
                  visitType: value as VisitRequestVisitType,
                }))
              }
              ariaLabel="訪問依頼の訪問区分"
            >
              <option value="">未指定</option>
              {VISIT_REQUEST_VISIT_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </NativeSelect>
          </label>
          <label className="flex flex-col gap-1">
            <FieldLabel>希望開始</FieldLabel>
            <Input
              type="datetime-local"
              value={form.desiredStartAt}
              onChange={(event) =>
                setForm((current) => ({ ...current, desiredStartAt: event.target.value }))
              }
              aria-label="訪問依頼の希望開始"
            />
          </label>
          <label className="flex flex-col gap-1">
            <FieldLabel>希望終了</FieldLabel>
            <Input
              type="datetime-local"
              value={form.desiredEndAt}
              onChange={(event) =>
                setForm((current) => ({ ...current, desiredEndAt: event.target.value }))
              }
              aria-label="訪問依頼の希望終了"
            />
          </label>
          <label className="flex flex-col gap-1 sm:col-span-2">
            <FieldLabel>依頼理由</FieldLabel>
            <Textarea
              value={form.requestReason}
              onChange={(event) =>
                setForm((current) => ({ ...current, requestReason: event.target.value }))
              }
              aria-label="訪問依頼の依頼理由"
              className="min-h-20"
            />
          </label>
          <label className="flex flex-col gap-1 sm:col-span-2">
            <FieldLabel>医師指示</FieldLabel>
            <Textarea
              value={form.physicianInstruction}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  physicianInstruction: event.target.value,
                }))
              }
              aria-label="訪問依頼の医師指示"
              className="min-h-20"
            />
          </label>
          <label className="flex flex-col gap-1 sm:col-span-2">
            <FieldLabel>持参薬・物品</FieldLabel>
            <Textarea
              value={form.carryItems}
              onChange={(event) =>
                setForm((current) => ({ ...current, carryItems: event.target.value }))
              }
              aria-label="訪問依頼の持参薬・物品"
              className="min-h-20"
            />
          </label>
          <label className="flex flex-col gap-1 sm:col-span-2">
            <FieldLabel>居宅注意事項</FieldLabel>
            <Textarea
              value={form.patientHomeNotes}
              onChange={(event) =>
                setForm((current) => ({ ...current, patientHomeNotes: event.target.value }))
              }
              aria-label="訪問依頼の居宅注意事項"
              className="min-h-20"
            />
          </label>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button type="button" disabled={isBusy || !canCreate} onClick={onCreate}>
          <Send className="size-4" aria-hidden="true" />
          訪問依頼を作成
        </Button>
        <TinyMeta>
          {selectedShareCase
            ? `${selectedShareCase.partnership.partner_pharmacy.name} / ${formatDate(
                selectedShareCase.starts_at,
              )} - ${formatDate(selectedShareCase.ends_at)}`
            : '共有中ケースなし'}
        </TinyMeta>
        {!hasOrderedWindow ? <TinyMeta>希望終了は開始より後にしてください</TinyMeta> : null}
      </div>
    </div>
  );
}

function PartnerVisitRecordDraftPanel({
  visitRequests,
  selectedVisitRequestId,
  setSelectedVisitRequestId,
  form,
  setForm,
  isBusy,
  onSave,
}: {
  visitRequests: PharmacyVisitRequestRow[];
  selectedVisitRequestId: string;
  setSelectedVisitRequestId: (id: string) => void;
  form: PartnerVisitRecordDraftForm;
  setForm: Dispatch<SetStateAction<PartnerVisitRecordDraftForm>>;
  isBusy: boolean;
  onSave: () => void;
}) {
  const selectedVisitRequest =
    visitRequests.find((row) => row.id === selectedVisitRequestId) ?? null;
  const recordContent = buildPartnerVisitRecordContent(form);
  const canSave =
    Boolean(selectedVisitRequestId) &&
    Boolean(selectedVisitRequest) &&
    form.visitAt.trim().length > 0 &&
    Object.keys(recordContent).length > 0;

  return (
    <div className="rounded-md border border-border/60 bg-muted/30 p-3">
      <div className="grid gap-3 lg:grid-cols-[minmax(12rem,18rem)_1fr]">
        <label className="flex flex-col gap-1">
          <FieldLabel>訪問依頼</FieldLabel>
          <NativeSelect
            value={selectedVisitRequestId}
            onChange={setSelectedVisitRequestId}
            disabled={visitRequests.length === 0}
            ariaLabel="協力訪問記録の訪問依頼"
          >
            {visitRequests.length === 0 ? <option value="">未選択</option> : null}
            {visitRequests.map((row) => (
              <option key={row.id} value={row.id}>
                {row.id} / {statusLabel(row.status)}
              </option>
            ))}
          </NativeSelect>
        </label>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          <label className="flex flex-col gap-1">
            <FieldLabel>訪問日時</FieldLabel>
            <Input
              type="datetime-local"
              value={form.visitAt}
              onChange={(event) =>
                setForm((current) => ({ ...current, visitAt: event.target.value }))
              }
              aria-label="協力訪問記録の訪問日時"
            />
          </label>
          <label className="flex flex-col gap-1">
            <FieldLabel>薬剤師ID</FieldLabel>
            <Input
              value={form.pharmacistId}
              onChange={(event) =>
                setForm((current) => ({ ...current, pharmacistId: event.target.value }))
              }
              aria-label="協力訪問記録の薬剤師ID"
            />
          </label>
          <label className="flex flex-col gap-1">
            <FieldLabel>薬剤師名</FieldLabel>
            <Input
              value={form.pharmacistName}
              onChange={(event) =>
                setForm((current) => ({ ...current, pharmacistName: event.target.value }))
              }
              aria-label="協力訪問記録の薬剤師名"
            />
          </label>
          <label className="flex flex-col gap-1">
            <FieldLabel>元記録ID</FieldLabel>
            <Input
              value={form.sourceVisitRecordId}
              onChange={(event) =>
                setForm((current) => ({ ...current, sourceVisitRecordId: event.target.value }))
              }
              aria-label="協力訪問記録の元記録ID"
            />
          </label>
          <label className="flex flex-col gap-1 sm:col-span-2">
            <FieldLabel>服薬状況</FieldLabel>
            <Textarea
              value={form.medicationAdherence}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  medicationAdherence: event.target.value,
                }))
              }
              aria-label="協力訪問記録の服薬状況"
              className="min-h-16"
            />
          </label>
          <label className="flex flex-col gap-1">
            <FieldLabel>残薬</FieldLabel>
            <Textarea
              value={form.remainingMedications}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  remainingMedications: event.target.value,
                }))
              }
              aria-label="協力訪問記録の残薬"
              className="min-h-16"
            />
          </label>
          <label className="flex flex-col gap-1">
            <FieldLabel>副作用疑い</FieldLabel>
            <Textarea
              value={form.suspectedAdverseEffects}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  suspectedAdverseEffects: event.target.value,
                }))
              }
              aria-label="協力訪問記録の副作用疑い"
              className="min-h-16"
            />
          </label>
          <label className="flex flex-col gap-1">
            <FieldLabel>保管状況</FieldLabel>
            <Textarea
              value={form.storageStatus}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  storageStatus: event.target.value,
                }))
              }
              aria-label="協力訪問記録の保管状況"
              className="min-h-16"
            />
          </label>
          <label className="flex flex-col gap-1 sm:col-span-2">
            <FieldLabel>提案</FieldLabel>
            <Textarea
              value={form.proposals}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  proposals: event.target.value,
                }))
              }
              aria-label="協力訪問記録の提案"
              className="min-h-16"
            />
          </label>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button type="button" disabled={isBusy || !canSave} onClick={onSave}>
          <Send className="size-4" aria-hidden="true" />
          下書き保存
        </Button>
        <TinyMeta>
          {selectedVisitRequest ? `${selectedVisitRequest.partner_pharmacy.name}` : '依頼選択待ち'}
        </TinyMeta>
      </div>
    </div>
  );
}

function PartnerVisitRecordsTable({
  rows,
  returnReasons,
  setReturnReasons,
  isBusy,
  onSubmit,
  onConfirm,
  onReturn,
  onCreateReport,
}: {
  rows: PartnerVisitRecordRow[];
  returnReasons: Record<string, string>;
  setReturnReasons: Dispatch<SetStateAction<Record<string, string>>>;
  isBusy: boolean;
  onSubmit: (row: PartnerVisitRecordRow) => void;
  onConfirm: (row: PartnerVisitRecordRow, doctorReportRequired: boolean) => void;
  onReturn: (row: PartnerVisitRecordRow, reason: string) => void;
  onCreateReport: (row: PartnerVisitRecordRow) => void;
}) {
  if (rows.length === 0) {
    return <EmptyState title="協力訪問記録はまだありません" />;
  }
  const partnerVisitRecordColumns: ColumnDef<PartnerVisitRecordRow>[] = [
    {
      id: 'record',
      header: '訪問記録',
      meta: { label: '訪問記録' },
      cell: ({ row }) => <PartnerVisitRecordSummaryCell record={row.original} />,
      enableSorting: false,
    },
    {
      id: 'owner_partner_pharmacy',
      header: '協力薬局',
      meta: { label: '協力薬局' },
      cell: ({ row }) => row.original.owner_partner_pharmacy.name,
      enableSorting: false,
    },
    {
      id: 'visit_at',
      header: '訪問日時',
      meta: { label: '訪問日時' },
      cell: ({ row }) => (
        <span className="tabular-nums">{formatDateTime(row.original.visit_at)}</span>
      ),
      enableSorting: false,
    },
    {
      id: 'claim_note',
      header: '請求メモ',
      meta: { label: '請求メモ' },
      cell: ({ row }) => <PartnerVisitRecordClaimNoteCell record={row.original} />,
      enableSorting: false,
    },
    {
      id: 'action',
      header: '操作',
      meta: { label: '操作' },
      cell: ({ row }) => (
        <PartnerVisitRecordActionCell
          record={row.original}
          returnReason={returnReasons[row.original.id] ?? ''}
          setReturnReasons={setReturnReasons}
          isBusy={isBusy}
          onSubmit={onSubmit}
          onConfirm={onConfirm}
          onReturn={onReturn}
          onCreateReport={onCreateReport}
        />
      ),
      enableSorting: false,
    },
  ];

  return (
    <DataTable
      columns={partnerVisitRecordColumns}
      data={rows}
      caption="協力訪問記録一覧"
      getRowId={(row) => row.id}
      getRowA11yLabel={(row) =>
        `${row.id} ${row.owner_partner_pharmacy.name} ${statusLabel(row.status)}`
      }
      emptyMessage="協力訪問記録はまだありません"
    />
  );
}

function CorrectionRequestsPanel({
  shareCases,
  selectedShareCaseId,
  setSelectedShareCaseId,
  correctionRequests,
  correctionForm,
  setCorrectionForm,
  isLoading,
  isError,
  error,
  isBusy,
  onRetry,
  onCreate,
}: {
  shareCases: PatientShareCaseRow[];
  selectedShareCaseId: string;
  setSelectedShareCaseId: (id: string) => void;
  correctionRequests: CorrectionRequestRow[];
  correctionForm: CorrectionForm;
  setCorrectionForm: Dispatch<SetStateAction<CorrectionForm>>;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  isBusy: boolean;
  onRetry: () => void;
  onCreate: () => void;
}) {
  const selectedShareCase = shareCases.find((row) => row.id === selectedShareCaseId) ?? null;
  const fieldOptions = CORRECTION_FIELD_OPTIONS[correctionForm.targetType];
  const canCreate =
    Boolean(selectedShareCaseId) &&
    selectedShareCase?.status === 'active' &&
    correctionForm.reason.trim().length > 0 &&
    (correctionForm.targetType === 'patient_profile' || correctionForm.targetId.trim().length > 0);

  const updateTargetType = (targetType: CorrectionTargetType) => {
    setCorrectionForm((current) => ({
      ...current,
      targetType,
      fieldPath: CORRECTION_FIELD_OPTIONS[targetType][0]?.value ?? '',
      targetId: targetType === 'patient_profile' ? '' : current.targetId,
    }));
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 rounded-md border border-border/60 bg-muted/30 p-3 lg:grid-cols-[minmax(12rem,18rem)_1fr]">
        <label className="flex flex-col gap-1">
          <FieldLabel>共有ケース</FieldLabel>
          <NativeSelect
            value={selectedShareCaseId}
            onChange={setSelectedShareCaseId}
            disabled={shareCases.length === 0}
            ariaLabel="修正依頼の共有ケース"
          >
            {shareCases.length === 0 ? <option value="">未選択</option> : null}
            {shareCases.map((row) => (
              <option key={row.id} value={row.id}>
                {row.id} / {statusLabel(row.status)}
              </option>
            ))}
          </NativeSelect>
        </label>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          <label className="flex flex-col gap-1">
            <FieldLabel>対象</FieldLabel>
            <NativeSelect
              value={correctionForm.targetType}
              onChange={(value) => updateTargetType(value as CorrectionTargetType)}
              ariaLabel="修正依頼の対象"
            >
              {Object.entries(CORRECTION_TARGET_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </NativeSelect>
          </label>
          <label className="flex flex-col gap-1">
            <FieldLabel>項目</FieldLabel>
            <NativeSelect
              value={correctionForm.fieldPath}
              onChange={(value) =>
                setCorrectionForm((current) => ({ ...current, fieldPath: value }))
              }
              ariaLabel="修正依頼の項目"
            >
              {fieldOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </NativeSelect>
          </label>
          <label className="flex flex-col gap-1">
            <FieldLabel>種別</FieldLabel>
            <NativeSelect
              value={correctionForm.requestType}
              onChange={(value) =>
                setCorrectionForm((current) => ({
                  ...current,
                  requestType: value as CorrectionRequestType,
                }))
              }
              ariaLabel="修正依頼の種別"
            >
              <option value="correction">修正</option>
              <option value="addition">追記</option>
            </NativeSelect>
          </label>
          <label className="flex flex-col gap-1">
            <FieldLabel>対象ID</FieldLabel>
            <Input
              value={correctionForm.targetId}
              onChange={(event) =>
                setCorrectionForm((current) => ({
                  ...current,
                  targetId: event.target.value,
                }))
              }
              disabled={correctionForm.targetType === 'patient_profile'}
              aria-label="修正依頼の対象ID"
            />
          </label>
          <label className="flex flex-col gap-1 sm:col-span-2">
            <FieldLabel>修正理由</FieldLabel>
            <Textarea
              value={correctionForm.reason}
              onChange={(event) =>
                setCorrectionForm((current) => ({
                  ...current,
                  reason: event.target.value,
                }))
              }
              aria-label="修正依頼の理由"
              className="min-h-20"
            />
          </label>
          <label className="flex flex-col gap-1 sm:col-span-2 xl:col-span-3">
            <FieldLabel>提案値</FieldLabel>
            <Textarea
              value={correctionForm.proposedValue}
              onChange={(event) =>
                setCorrectionForm((current) => ({
                  ...current,
                  proposedValue: event.target.value,
                }))
              }
              aria-label="修正依頼の提案値"
              className="min-h-16"
            />
          </label>
        </div>
        <div className="lg:col-span-2">
          <Button type="button" disabled={isBusy || !canCreate} onClick={onCreate}>
            <PencilLine className="size-4" aria-hidden="true" />
            修正依頼を作成
          </Button>
          {selectedShareCase && selectedShareCase.status !== 'active' ? (
            <span className="ml-3 text-xs text-muted-foreground">共有中のみ作成できます</span>
          ) : null}
        </div>
      </div>

      <QueryFallback isLoading={isLoading} isError={isError} error={error} onRetry={onRetry}>
        {correctionRequests.length === 0 ? (
          <EmptyState title="修正依頼はまだありません" />
        ) : (
          <DataTable
            columns={correctionRequestColumns}
            data={correctionRequests}
            caption="修正依頼一覧"
            getRowId={(row) => row.id}
            getRowA11yLabel={(row) =>
              `${row.id} ${CORRECTION_TARGET_LABELS[row.target_type] ?? row.target_type} ${statusLabel(
                row.status,
              )}`
            }
            emptyMessage="修正依頼はまだありません"
            toolbar={{
              enableGlobalFilter: true,
              globalFilterPlaceholder: '修正依頼内検索',
              enableColumnVisibility: true,
              filterFields: [
                { columnId: 'target', label: '対象', placeholder: '対象で絞り込み' },
                { columnId: 'status', label: '状態', placeholder: '状態で絞り込み' },
              ],
            }}
          />
        )}
      </QueryFallback>
    </div>
  );
}

function MessageThreadsPanel({
  activeShareCases,
  activeShareCaseTotalCount,
  visitRequests,
  selectedShareCaseId,
  setSelectedShareCaseId,
  selectedVisitRequestId,
  setSelectedVisitRequestId,
  messageThreads,
  form,
  setForm,
  isLoading,
  isError,
  error,
  isBusy,
  onRetry,
  onCreate,
}: {
  activeShareCases: PatientShareCaseRow[];
  activeShareCaseTotalCount: number;
  visitRequests: PharmacyVisitRequestRow[];
  selectedShareCaseId: string;
  setSelectedShareCaseId: Dispatch<SetStateAction<string>>;
  selectedVisitRequestId: string;
  setSelectedVisitRequestId: Dispatch<SetStateAction<string>>;
  messageThreads: PharmacyCooperationMessageThreadRow[];
  form: MessageForm;
  setForm: Dispatch<SetStateAction<MessageForm>>;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  isBusy: boolean;
  onRetry: () => void;
  onCreate: () => void;
}) {
  const visitRequestOptions = visitRequests.filter(
    (request) => request.share_case_id === selectedShareCaseId,
  );
  const canCreate =
    activeShareCases.some((shareCase) => shareCase.id === selectedShareCaseId) &&
    form.body.trim().length > 0;

  if (activeShareCaseTotalCount === 0) {
    return <EmptyState title="共有中の患者共有ケースがありません" />;
  }
  if (activeShareCases.length === 0) {
    return <EmptyState title="共有中の患者共有ケースは未表示です" />;
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1fr)]">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <FieldLabel>共有ケース</FieldLabel>
            <NativeSelect
              value={selectedShareCaseId}
              onChange={(value) => {
                setSelectedShareCaseId(value);
                setSelectedVisitRequestId('');
              }}
              disabled={isBusy}
              ariaLabel="メッセージの共有ケース"
            >
              {activeShareCases.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.id} / {row.partnership.partner_pharmacy.name}
                </option>
              ))}
            </NativeSelect>
          </label>
          <label className="flex flex-col gap-1">
            <FieldLabel>対象</FieldLabel>
            <NativeSelect
              value={selectedVisitRequestId}
              onChange={setSelectedVisitRequestId}
              disabled={isBusy}
              ariaLabel="メッセージの対象"
            >
              <option value="">患者共有ケース全体</option>
              {visitRequestOptions.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.id} / {statusLabel(row.status)}
                </option>
              ))}
            </NativeSelect>
          </label>
        </div>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <label className="flex flex-col gap-1">
            <FieldLabel>本文</FieldLabel>
            <Textarea
              value={form.body}
              onChange={(event) => setForm((current) => ({ ...current, body: event.target.value }))}
              aria-label="薬局間連携メッセージ本文"
              className="min-h-20"
            />
          </label>
          <Button type="button" disabled={isBusy || !canCreate} onClick={onCreate}>
            <Send className="size-4" aria-hidden="true" />
            メッセージ送信
          </Button>
        </div>
      </div>

      <QueryFallback isLoading={isLoading} isError={isError} error={error} onRetry={onRetry}>
        {messageThreads.length === 0 ? (
          <EmptyState title="メッセージはまだありません" />
        ) : (
          <div className="space-y-3" aria-label="薬局間連携メッセージ一覧">
            {messageThreads.map((thread) => (
              <article key={thread.id} className="rounded-lg border border-border/70 p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">
                      {messageContextLabel(thread)}
                    </h3>
                    <TinyMeta>
                      {thread.id} / 最終{' '}
                      {formatDateTime(thread.last_message_at ?? thread.updated_at)}
                    </TinyMeta>
                  </div>
                  <Badge variant={statusVariant(thread.status)}>{statusLabel(thread.status)}</Badge>
                </div>
                {thread.messages.length === 0 ? (
                  <div className="mt-3">
                    <TinyMeta>このスレッドのメッセージはありません</TinyMeta>
                  </div>
                ) : (
                  <ol className="mt-3 space-y-2">
                    {thread.messages.map((message) => (
                      <li key={message.id} className="rounded-md border border-border/60 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-xs font-medium text-muted-foreground">
                            {messageSenderSideLabel(message.sender_side)}
                          </span>
                          <span className="text-xs tabular-nums text-muted-foreground">
                            {formatDateTime(message.created_at)}
                          </span>
                        </div>
                        <p className="mt-2 whitespace-pre-wrap break-words text-sm text-foreground">
                          {message.body}
                        </p>
                      </li>
                    ))}
                  </ol>
                )}
              </article>
            ))}
          </div>
        )}
      </QueryFallback>
    </div>
  );
}

export function PharmacyCooperationWorkflowContent() {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const [declineReasons, setDeclineReasons] = useState<Record<string, string>>({});
  const [returnReasons, setReturnReasons] = useState<Record<string, string>>({});
  const [linkAcceptForms, setLinkAcceptForms] = useState<Record<string, LinkAcceptForm>>({});
  const [linkDeclineReasons, setLinkDeclineReasons] = useState<Record<string, string>>({});
  const [selectedConsentShareCaseId, setSelectedConsentShareCaseId] = useState('');
  const consentFormMethods = useForm<PatientShareConsentForm>({
    resolver: zodResolver(patientShareConsentFormSchema),
    defaultValues: EMPTY_PATIENT_SHARE_CONSENT_FORM,
  });
  const [consentRevokeReasons, setConsentRevokeReasons] = useState<Record<string, string>>({});
  const [selectedCorrectionShareCaseId, setSelectedCorrectionShareCaseId] = useState('');
  const [correctionForm, setCorrectionForm] = useState<CorrectionForm>(EMPTY_CORRECTION_FORM);
  const [selectedVisitRequestShareCaseId, setSelectedVisitRequestShareCaseId] = useState('');
  const [visitRequestForm, setVisitRequestForm] =
    useState<VisitRequestForm>(EMPTY_VISIT_REQUEST_FORM);
  const [selectedMessageShareCaseId, setSelectedMessageShareCaseId] = useState('');
  const [selectedMessageVisitRequestId, setSelectedMessageVisitRequestId] = useState('');
  const [messageForm, setMessageForm] = useState<MessageForm>(EMPTY_MESSAGE_FORM);
  const [selectedRecordVisitRequestId, setSelectedRecordVisitRequestId] = useState('');
  const [recordDraftForm, setRecordDraftForm] = useState<PartnerVisitRecordDraftForm>(
    EMPTY_PARTNER_VISIT_RECORD_DRAFT_FORM,
  );
  const [lastReportDraft, setLastReportDraft] = useState<ReportDraftResult | null>(null);
  const [pendingWorkflowAction, setPendingWorkflowAction] = useState<PendingWorkflowAction | null>(
    null,
  );
  const enabled = Boolean(orgId);

  const shareCasesQuery = useQuery({
    queryKey: ['pharmacy-cooperation-share-cases', orgId],
    queryFn: () => fetchShareCases(orgId),
    enabled,
    staleTime: 20_000,
  });

  const visitRequestsQuery = useQuery({
    queryKey: ['pharmacy-cooperation-visit-requests', orgId],
    queryFn: () => fetchVisitRequests(orgId),
    enabled,
    staleTime: 20_000,
  });

  const partnerVisitRecordsQuery = useQuery({
    queryKey: ['pharmacy-cooperation-partner-visit-records', orgId],
    queryFn: () => fetchPartnerVisitRecords(orgId),
    enabled,
    staleTime: 20_000,
  });

  const shareCases = shareCasesQuery.data?.data ?? [];
  const shareCaseTotalCount = shareCasesQuery.data?.total_count ?? shareCases.length;
  const shareCaseVisibleCount = shareCasesQuery.data?.visible_count ?? shareCases.length;
  const shareCaseHiddenCount = shareCasesQuery.data?.hidden_count ?? 0;
  const shareCaseStatusCounts =
    shareCasesQuery.data?.status_counts ?? buildVisiblePatientShareCaseStatusCounts(shareCases);
  const activeShareCaseTotalCount = shareCaseStatusCounts.active;
  const inactiveShareCaseTotalCount = Math.max(shareCaseTotalCount - activeShareCaseTotalCount, 0);
  const shareCaseCountLabel =
    shareCaseHiddenCount > 0
      ? `共有ケース ${shareCaseTotalCount} 件 / 表示 ${shareCaseVisibleCount} 件 / 他 ${shareCaseHiddenCount} 件`
      : `共有ケース ${shareCaseTotalCount} 件`;
  const visitRequests = visitRequestsQuery.data?.data ?? [];
  const partnerVisitRecords = partnerVisitRecordsQuery.data?.data ?? [];
  const activeShareCases = shareCases.filter((shareCase) => shareCase.status === 'active');
  const draftableVisitRequests = visitRequests.filter(
    (request) =>
      request.status === 'accepted' ||
      request.status === 'recording' ||
      request.status === 'returned',
  );
  const selectedRecordVisitRequestStillVisible = draftableVisitRequests.some(
    (request) => request.id === selectedRecordVisitRequestId,
  );
  const effectiveRecordVisitRequestId = selectedRecordVisitRequestStillVisible
    ? selectedRecordVisitRequestId
    : (draftableVisitRequests[0]?.id ?? '');
  const selectedConsentShareCaseStillVisible = shareCases.some(
    (row) => row.id === selectedConsentShareCaseId,
  );
  const effectiveConsentShareCaseId = selectedConsentShareCaseStillVisible
    ? selectedConsentShareCaseId
    : (shareCases[0]?.id ?? '');
  const correctionDefaultShareCase =
    shareCases.find((row) => row.status === 'active') ?? shareCases[0];
  const selectedCorrectionShareCaseStillVisible = shareCases.some(
    (row) => row.id === selectedCorrectionShareCaseId,
  );
  const effectiveCorrectionShareCaseId = selectedCorrectionShareCaseStillVisible
    ? selectedCorrectionShareCaseId
    : (correctionDefaultShareCase?.id ?? '');
  const selectedVisitRequestShareCaseStillVisible = activeShareCases.some(
    (row) => row.id === selectedVisitRequestShareCaseId,
  );
  const effectiveVisitRequestShareCaseId = selectedVisitRequestShareCaseStillVisible
    ? selectedVisitRequestShareCaseId
    : (activeShareCases[0]?.id ?? '');
  const selectedMessageShareCaseStillVisible = activeShareCases.some(
    (row) => row.id === selectedMessageShareCaseId,
  );
  const effectiveMessageShareCaseId = selectedMessageShareCaseStillVisible
    ? selectedMessageShareCaseId
    : (activeShareCases[0]?.id ?? '');
  const messageVisitRequestOptions = visitRequests.filter(
    (request) => request.share_case_id === effectiveMessageShareCaseId,
  );
  const selectedMessageVisitRequestStillVisible =
    selectedMessageVisitRequestId === '' ||
    messageVisitRequestOptions.some((request) => request.id === selectedMessageVisitRequestId);
  const effectiveMessageVisitRequestId = selectedMessageVisitRequestStillVisible
    ? selectedMessageVisitRequestId
    : '';

  const correctionRequestsQuery = useQuery({
    queryKey: ['pharmacy-cooperation-correction-requests', orgId, effectiveCorrectionShareCaseId],
    queryFn: () => fetchCorrectionRequests(orgId, effectiveCorrectionShareCaseId),
    enabled: enabled && effectiveCorrectionShareCaseId.length > 0,
    staleTime: 20_000,
  });

  const patientShareConsentsQuery = useQuery({
    queryKey: ['pharmacy-cooperation-share-consents', orgId, effectiveConsentShareCaseId],
    queryFn: () => fetchPatientShareConsents(orgId, effectiveConsentShareCaseId),
    enabled: enabled && effectiveConsentShareCaseId.length > 0,
    staleTime: 20_000,
  });

  const messageThreadsQuery = useQuery({
    queryKey: [
      'pharmacy-cooperation-message-threads',
      orgId,
      effectiveMessageShareCaseId,
      effectiveMessageVisitRequestId,
    ],
    queryFn: () =>
      fetchMessageThreads(
        orgId,
        effectiveMessageShareCaseId,
        effectiveMessageVisitRequestId || null,
      ),
    enabled: enabled && effectiveMessageShareCaseId.length > 0,
    staleTime: 10_000,
  });

  const invalidateWorkflow = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['pharmacy-cooperation-share-cases', orgId] }),
      queryClient.invalidateQueries({ queryKey: ['pharmacy-cooperation-visit-requests', orgId] }),
      queryClient.invalidateQueries({
        queryKey: ['pharmacy-cooperation-partner-visit-records', orgId],
      }),
      queryClient.invalidateQueries({
        queryKey: [
          'pharmacy-cooperation-correction-requests',
          orgId,
          effectiveCorrectionShareCaseId,
        ],
      }),
      queryClient.invalidateQueries({
        queryKey: ['pharmacy-cooperation-share-consents', orgId, effectiveConsentShareCaseId],
      }),
      queryClient.invalidateQueries({
        queryKey: ['pharmacy-cooperation-message-threads', orgId],
      }),
    ]);
  };

  const activateShareCaseMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/patient-share-cases/${id}/activate`, {
        method: 'POST',
        headers: buildOrgHeaders(orgId),
      });
      return readApiJson<unknown>(response);
    },
    onSuccess: async () => {
      toast.success('患者共有ケースを共有中にしました');
      await invalidateWorkflow();
    },
    onError: (error) => {
      toast.error(messageFromError(error, '患者共有ケースの有効化に失敗しました'));
    },
  });

  const patientLinkMutation = useMutation({
    mutationFn: async ({
      id,
      decision,
      acceptForm,
      declineReason,
    }: {
      id: string;
      decision: 'base_approve' | 'accept' | 'decline';
      acceptForm?: LinkAcceptForm;
      declineReason?: string;
    }) => {
      const response = await fetch(`/api/patient-share-cases/${id}/patient-link`, {
        method: 'PATCH',
        headers: buildOrgHeaders(orgId, { 'content-type': 'application/json' }),
        body: JSON.stringify({
          decision,
          ...(decision === 'accept' && acceptForm
            ? {
                partner_patient_id: acceptForm.partnerPatientId,
                partner_patient_snapshot: {
                  name: acceptForm.name,
                  ...(acceptForm.nameKana.trim() ? { name_kana: acceptForm.nameKana.trim() } : {}),
                  birth_date: acceptForm.birthDate,
                  ...(acceptForm.address.trim() ? { address: acceptForm.address.trim() } : {}),
                },
                ...(acceptForm.overrideReason.trim()
                  ? { identity_mismatch_override_reason: acceptForm.overrideReason.trim() }
                  : {}),
              }
            : {}),
          ...(decision === 'decline' && declineReason
            ? { decline_reason: declineReason.trim() }
            : {}),
        }),
      });
      return readApiJson<unknown>(response);
    },
    onSuccess: async () => {
      toast.success('患者リンクを更新しました');
      await invalidateWorkflow();
    },
    onError: (error) => {
      toast.error(messageFromError(error, '患者リンクの更新に失敗しました'));
    },
  });

  const createPatientShareConsentMutation = useMutation({
    mutationFn: async () => {
      const currentConsentForm = consentFormMethods.getValues();
      const response = await fetch(
        `/api/patient-share-cases/${effectiveConsentShareCaseId}/consents`,
        {
          method: 'POST',
          headers: buildOrgHeaders(orgId, { 'content-type': 'application/json' }),
          body: JSON.stringify({
            consent_date: currentConsentForm.consentDate,
            consent_person: currentConsentForm.consentPerson,
            consent_method: currentConsentForm.consentMethod,
            scope: {
              pdf_output: currentConsentForm.allowPdfOutput,
              attachments: currentConsentForm.allowAttachments,
            },
            ...(currentConsentForm.consentRecordId.trim()
              ? { consent_record_id: currentConsentForm.consentRecordId.trim() }
              : {}),
            ...(currentConsentForm.fileAssetId.trim()
              ? { file_asset_id: currentConsentForm.fileAssetId.trim() }
              : {}),
            ...(currentConsentForm.validUntil.trim()
              ? { valid_until: currentConsentForm.validUntil.trim() }
              : {}),
          }),
        },
      );
      return readApiJson<PatientShareConsentRow>(response, {
        fallbackMessage: '患者共有同意の登録に失敗しました',
        schema: patientShareConsentResponseSchema,
      });
    },
    onSuccess: async () => {
      toast.success('患者共有同意を登録しました');
      consentFormMethods.reset(EMPTY_PATIENT_SHARE_CONSENT_FORM);
      await invalidateWorkflow();
    },
    onError: (error) => {
      toast.error(messageFromError(error, '患者共有同意の登録に失敗しました'));
    },
  });

  const revokePatientShareConsentMutation = useMutation({
    mutationFn: async ({
      shareCaseId,
      consentId,
      reason,
    }: {
      shareCaseId: string;
      consentId: string;
      reason: string;
    }) => {
      const trimmedReason = reason.trim();
      if (!trimmedReason) throw new Error('撤回理由を入力してください');

      const response = await fetch(
        `/api/patient-share-cases/${shareCaseId}/consents/${consentId}/revoke`,
        {
          method: 'POST',
          headers: buildOrgHeaders(orgId, { 'content-type': 'application/json' }),
          body: JSON.stringify({ reason: trimmedReason }),
        },
      );
      return readApiJson<unknown>(response);
    },
    onSuccess: async () => {
      toast.success('患者共有同意を撤回しました');
      await invalidateWorkflow();
    },
    onError: (error) => {
      toast.error(messageFromError(error, '患者共有同意の撤回に失敗しました'));
    },
  });

  const createCorrectionRequestMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(
        `/api/patient-share-cases/${effectiveCorrectionShareCaseId}/correction-requests`,
        {
          method: 'POST',
          headers: buildOrgHeaders(orgId, { 'content-type': 'application/json' }),
          body: JSON.stringify({
            target_type: correctionForm.targetType,
            request_type: correctionForm.requestType,
            ...(correctionForm.fieldPath.trim()
              ? { field_path: correctionForm.fieldPath.trim() }
              : {}),
            ...(correctionForm.targetId.trim()
              ? { target_id: correctionForm.targetId.trim() }
              : {}),
            reason: correctionForm.reason.trim(),
            ...(correctionForm.proposedValue.trim()
              ? { proposed_value: correctionForm.proposedValue.trim() }
              : {}),
          }),
        },
      );
      return readApiJson<CorrectionRequestRow>(response, {
        fallbackMessage: '修正依頼の作成に失敗しました',
        schema: correctionRequestResponseSchema,
      });
    },
    onSuccess: async () => {
      toast.success('修正依頼を作成しました');
      setCorrectionForm(EMPTY_CORRECTION_FORM);
      await invalidateWorkflow();
    },
    onError: (error) => {
      toast.error(messageFromError(error, '修正依頼の作成に失敗しました'));
    },
  });

  const createVisitRequestMutation = useMutation({
    mutationFn: async () => {
      const carryItems = multilineItems(visitRequestForm.carryItems);
      const response = await fetch('/api/pharmacy-visit-requests', {
        method: 'POST',
        headers: buildOrgHeaders(orgId, { 'content-type': 'application/json' }),
        body: JSON.stringify({
          share_case_id: effectiveVisitRequestShareCaseId,
          urgency: visitRequestForm.urgency,
          ...(visitRequestForm.visitType ? { visit_type: visitRequestForm.visitType } : {}),
          desired_start_at: datetimeLocalToIso(visitRequestForm.desiredStartAt),
          ...(visitRequestForm.desiredEndAt.trim()
            ? { desired_end_at: datetimeLocalToIso(visitRequestForm.desiredEndAt) }
            : {}),
          request_reason: visitRequestForm.requestReason.trim(),
          ...(visitRequestForm.physicianInstruction.trim()
            ? { physician_instruction: visitRequestForm.physicianInstruction.trim() }
            : {}),
          ...(carryItems.length > 0 ? { carry_items: carryItems } : {}),
          ...(visitRequestForm.patientHomeNotes.trim()
            ? { patient_home_notes: visitRequestForm.patientHomeNotes.trim() }
            : {}),
        }),
      });
      return readApiJson<PharmacyVisitRequestRow>(response, {
        fallbackMessage: '訪問依頼の作成に失敗しました',
        schema: pharmacyVisitRequestRowSchema,
      });
    },
    onSuccess: async () => {
      toast.success('訪問依頼を作成しました');
      setVisitRequestForm(EMPTY_VISIT_REQUEST_FORM);
      await invalidateWorkflow();
    },
    onError: (error) => {
      toast.error(messageFromError(error, '訪問依頼の作成に失敗しました'));
    },
  });

  const createMessageMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/pharmacy-cooperation-message-threads', {
        method: 'POST',
        headers: buildOrgHeaders(orgId, { 'content-type': 'application/json' }),
        body: JSON.stringify({
          share_case_id: effectiveMessageShareCaseId,
          ...(effectiveMessageVisitRequestId
            ? { visit_request_id: effectiveMessageVisitRequestId }
            : {}),
          body: messageForm.body.trim(),
        }),
      });
      return readApiJson<{
        thread: PharmacyCooperationMessageThreadRow;
        notification_count: number;
      }>(response, {
        fallbackMessage: 'メッセージの送信に失敗しました',
        schema: messageThreadResultSchema,
      });
    },
    onSuccess: async () => {
      toast.success('メッセージを送信しました');
      setMessageForm(EMPTY_MESSAGE_FORM);
      await invalidateWorkflow();
    },
    onError: (error) => {
      toast.error(messageFromError(error, 'メッセージの送信に失敗しました'));
    },
  });

  const savePartnerVisitRecordDraftMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/partner-visit-records', {
        method: 'POST',
        headers: buildOrgHeaders(orgId, { 'content-type': 'application/json' }),
        body: JSON.stringify({
          visit_request_id: effectiveRecordVisitRequestId,
          ...(recordDraftForm.pharmacistId.trim()
            ? { pharmacist_id: recordDraftForm.pharmacistId.trim() }
            : {}),
          ...(recordDraftForm.pharmacistName.trim()
            ? { pharmacist_name: recordDraftForm.pharmacistName.trim() }
            : {}),
          visit_at: datetimeLocalToIso(recordDraftForm.visitAt),
          record_content: buildPartnerVisitRecordContent(recordDraftForm),
          ...(recordDraftForm.sourceVisitRecordId.trim()
            ? { source_visit_record_id: recordDraftForm.sourceVisitRecordId.trim() }
            : {}),
        }),
      });
      return readApiJson<PartnerVisitRecordRow>(response, {
        fallbackMessage: '協力訪問記録の保存に失敗しました',
        schema: partnerVisitRecordResponseSchema.transform((payload) => payload.data),
      });
    },
    onSuccess: async () => {
      toast.success('協力訪問記録の下書きを保存しました');
      setRecordDraftForm(EMPTY_PARTNER_VISIT_RECORD_DRAFT_FORM);
      await invalidateWorkflow();
    },
    onError: (error) => {
      toast.error(messageFromError(error, '協力訪問記録の保存に失敗しました'));
    },
  });

  const visitRequestDecisionMutation = useMutation({
    mutationFn: async ({
      id,
      decision,
      expectedUpdatedAt,
      declineReason,
    }: {
      id: string;
      decision: 'accept' | 'decline';
      expectedUpdatedAt: string;
      declineReason?: string;
    }) => {
      const response = await fetch(`/api/pharmacy-visit-requests/${id}/decision`, {
        method: 'POST',
        headers: buildOrgHeaders(orgId, { 'content-type': 'application/json' }),
        body: JSON.stringify({
          decision,
          expected_updated_at: expectedUpdatedAt,
          ...(declineReason ? { decline_reason: declineReason } : {}),
        }),
      });
      return readApiJson<unknown>(response);
    },
    onSuccess: async () => {
      toast.success('訪問依頼を更新しました');
      await invalidateWorkflow();
    },
    onError: (error) => {
      toast.error(messageFromError(error, '訪問依頼の更新に失敗しました'));
    },
  });

  const submitRecordMutation = useMutation({
    mutationFn: async ({ id, expectedUpdatedAt }: { id: string; expectedUpdatedAt: string }) => {
      const response = await fetch(buildPartnerVisitRecordApiPath(id, '/submit'), {
        method: 'POST',
        headers: buildOrgHeaders(orgId, { 'content-type': 'application/json' }),
        body: JSON.stringify({ expected_updated_at: expectedUpdatedAt }),
      });
      return readApiJson<unknown>(response);
    },
    onSuccess: async () => {
      toast.success('協力訪問記録を提出しました');
      await invalidateWorkflow();
    },
    onError: (error) => {
      toast.error(messageFromError(error, '協力訪問記録の提出に失敗しました'));
    },
  });

  const reviewRecordMutation = useMutation({
    mutationFn: async ({
      id,
      decision,
      expectedUpdatedAt,
      returnReason,
      doctorReportRequired,
    }: {
      id: string;
      decision: 'confirm' | 'return';
      expectedUpdatedAt: string;
      returnReason?: string;
      doctorReportRequired?: boolean;
    }) => {
      const response = await fetch(buildPartnerVisitRecordApiPath(id, '/review'), {
        method: 'POST',
        headers: buildOrgHeaders(orgId, { 'content-type': 'application/json' }),
        body: JSON.stringify({
          decision,
          expected_updated_at: expectedUpdatedAt,
          ...(returnReason ? { return_reason: returnReason } : {}),
          doctor_report_required: Boolean(doctorReportRequired),
        }),
      });
      return readApiJson<unknown>(response);
    },
    onSuccess: async () => {
      toast.success('協力訪問記録を更新しました');
      await invalidateWorkflow();
    },
    onError: (error) => {
      toast.error(messageFromError(error, '協力訪問記録の更新に失敗しました'));
    },
  });

  const createReportDraftMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(buildPartnerVisitRecordApiPath(id, '/physician-report-draft'), {
        method: 'POST',
        headers: buildOrgHeaders(orgId),
      });
      return readApiJson<ReportDraftResult>(response, {
        fallbackMessage: '報告書ドラフトの作成に失敗しました',
        schema: reportDraftResponseSchema.transform((payload) => payload.data),
      });
    },
    onSuccess: async (result) => {
      setLastReportDraft(result);
      toast.success(result.message);
      await invalidateWorkflow();
    },
    onError: (error) => {
      toast.error(messageFromError(error, '報告書ドラフトの作成に失敗しました'));
    },
  });

  const isBusy =
    activateShareCaseMutation.isPending ||
    patientLinkMutation.isPending ||
    createPatientShareConsentMutation.isPending ||
    revokePatientShareConsentMutation.isPending ||
    createCorrectionRequestMutation.isPending ||
    createVisitRequestMutation.isPending ||
    createMessageMutation.isPending ||
    savePartnerVisitRecordDraftMutation.isPending ||
    visitRequestDecisionMutation.isPending ||
    submitRecordMutation.isPending ||
    reviewRecordMutation.isPending ||
    createReportDraftMutation.isPending;

  const executePendingWorkflowAction = () => {
    if (!pendingWorkflowAction || isBusy) return;

    switch (pendingWorkflowAction.kind) {
      case 'activateShareCase':
        activateShareCaseMutation.mutate(pendingWorkflowAction.shareCase.id);
        return;
      case 'baseApproveLink':
        patientLinkMutation.mutate({
          id: pendingWorkflowAction.shareCase.id,
          decision: 'base_approve',
        });
        return;
      case 'acceptLink':
        patientLinkMutation.mutate({
          id: pendingWorkflowAction.shareCase.id,
          decision: 'accept',
          acceptForm: pendingWorkflowAction.acceptForm,
        });
        return;
      case 'declineLink':
        patientLinkMutation.mutate({
          id: pendingWorkflowAction.shareCase.id,
          decision: 'decline',
          declineReason: pendingWorkflowAction.declineReason.trim(),
        });
        return;
      case 'revokePatientShareConsent':
        revokePatientShareConsentMutation.mutate({
          shareCaseId: pendingWorkflowAction.consent.share_case_id,
          consentId: pendingWorkflowAction.consent.id,
          reason: pendingWorkflowAction.reason.trim(),
        });
        return;
      case 'acceptVisitRequest':
        visitRequestDecisionMutation.mutate({
          id: pendingWorkflowAction.request.id,
          decision: 'accept',
          expectedUpdatedAt: pendingWorkflowAction.request.updated_at,
        });
        return;
      case 'declineVisitRequest':
        visitRequestDecisionMutation.mutate({
          id: pendingWorkflowAction.request.id,
          decision: 'decline',
          expectedUpdatedAt: pendingWorkflowAction.request.updated_at,
          declineReason: pendingWorkflowAction.declineReason.trim(),
        });
        return;
      case 'submitPartnerVisitRecord':
        submitRecordMutation.mutate({
          id: pendingWorkflowAction.record.id,
          expectedUpdatedAt: pendingWorkflowAction.record.updated_at,
        });
        return;
      case 'confirmPartnerVisitRecord':
        reviewRecordMutation.mutate({
          id: pendingWorkflowAction.record.id,
          decision: 'confirm',
          expectedUpdatedAt: pendingWorkflowAction.record.updated_at,
          doctorReportRequired: pendingWorkflowAction.doctorReportRequired,
        });
        return;
      case 'returnPartnerVisitRecord':
        reviewRecordMutation.mutate({
          id: pendingWorkflowAction.record.id,
          decision: 'return',
          expectedUpdatedAt: pendingWorkflowAction.record.updated_at,
          returnReason: pendingWorkflowAction.returnReason.trim(),
        });
        return;
      case 'createReportDraft':
        createReportDraftMutation.mutate(pendingWorkflowAction.record.id);
        return;
    }
  };

  const correctionRequests = correctionRequestsQuery.data?.data ?? [];
  const patientShareConsents = patientShareConsentsQuery.data?.data ?? [];
  const messageThreads = messageThreadsQuery.data?.data ?? [];
  const submittedRecords = partnerVisitRecords.filter((record) => record.status === 'submitted');
  const requestedVisits = visitRequests.filter((request) => request.status === 'requested');

  return (
    <div
      className="space-y-6 [&_a[data-slot=button]]:h-11 [&_a[data-slot=button]]:min-h-11 [&_a[data-slot=button]]:whitespace-normal [&_button]:h-11 [&_button]:min-h-11 [&_button]:whitespace-normal [&_input:not([type=checkbox])]:min-h-11 [&_select]:h-11 [&_select]:min-h-11 sm:[&_a[data-slot=button]]:h-11 sm:[&_a[data-slot=button]]:min-h-11 sm:[&_button]:h-11 sm:[&_button]:min-h-11"
      data-testid="pharmacy-cooperation-workflow"
    >
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <div className="flex min-h-[96px] flex-col justify-center rounded-lg border border-border/70 bg-card p-3 sm:p-4">
          <p className="text-xs leading-tight font-semibold text-foreground sm:text-sm">
            有効化待ち共有
          </p>
          <p className="mt-1 text-2xl leading-8 font-bold tabular-nums sm:text-[26px] sm:leading-9">
            {inactiveShareCaseTotalCount}
          </p>
          <TinyMeta>{shareCaseCountLabel}</TinyMeta>
        </div>
        <div className="flex min-h-[96px] flex-col justify-center rounded-lg border border-border/70 bg-card p-3 sm:p-4">
          <p className="text-xs leading-tight font-semibold text-foreground sm:text-sm">
            依頼中の訪問
          </p>
          <p className="mt-1 text-2xl leading-8 font-bold tabular-nums sm:text-[26px] sm:leading-9">
            {requestedVisits.length}
          </p>
          <TinyMeta>訪問依頼 {visitRequests.length} 件</TinyMeta>
        </div>
        <div className="flex min-h-[96px] flex-col justify-center rounded-lg border border-border/70 bg-card p-3 sm:p-4">
          <p className="text-xs leading-tight font-semibold text-foreground sm:text-sm">
            確認待ち記録
          </p>
          <p className="mt-1 text-2xl leading-8 font-bold tabular-nums sm:text-[26px] sm:leading-9">
            {submittedRecords.length}
          </p>
          <TinyMeta>協力訪問記録 {partnerVisitRecords.length} 件</TinyMeta>
        </div>
      </div>

      {lastReportDraft ? (
        <div
          className="rounded-lg border border-state-done/30 bg-state-done/10 px-4 py-3 text-sm text-state-done"
          data-testid="pharmacy-cooperation-report-result"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-semibold">報告書ドラフト: {lastReportDraft.report.id}</p>
              <p className="mt-1 text-state-done">
                {lastReportDraft.reused_existing_draft ? '既存ドラフトを再利用' : '新規作成'} /{' '}
                {statusLabel(lastReportDraft.report.status)}
              </p>
            </div>
            <a
              href={`/reports/${lastReportDraft.report.id}`}
              className={cn(
                buttonVariants({ variant: 'outline', size: 'sm' }),
                'h-11 min-h-11 bg-card sm:h-11 sm:min-h-11',
              )}
            >
              <FileText className="size-4" aria-hidden="true" />
              報告書を開く
            </a>
          </div>
        </div>
      ) : null}

      <div className="flex justify-end">
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            void shareCasesQuery.refetch();
            void visitRequestsQuery.refetch();
            void partnerVisitRecordsQuery.refetch();
            void correctionRequestsQuery.refetch();
            void patientShareConsentsQuery.refetch();
            if (effectiveMessageShareCaseId) void messageThreadsQuery.refetch();
          }}
        >
          <RefreshCw className="size-4" aria-hidden="true" />
          更新
        </Button>
      </div>

      <SectionShell title="患者共有ケース" description="共有状態と患者リンク承認を確認します。">
        <QueryFallback
          isLoading={shareCasesQuery.isLoading}
          isError={shareCasesQuery.isError}
          error={shareCasesQuery.error}
          onRetry={() => void shareCasesQuery.refetch()}
        >
          <ShareCasesTable
            rows={shareCases}
            linkAcceptForms={linkAcceptForms}
            setLinkAcceptForms={setLinkAcceptForms}
            linkDeclineReasons={linkDeclineReasons}
            setLinkDeclineReasons={setLinkDeclineReasons}
            isBusy={isBusy}
            onActivate={(shareCase) =>
              setPendingWorkflowAction({ kind: 'activateShareCase', shareCase })
            }
            onBaseApprove={(shareCase) =>
              setPendingWorkflowAction({ kind: 'baseApproveLink', shareCase })
            }
            onAcceptLink={(shareCase, acceptForm) =>
              setPendingWorkflowAction({
                kind: 'acceptLink',
                shareCase,
                acceptForm: { ...acceptForm },
              })
            }
            onDeclineLink={(shareCase, declineReason) =>
              setPendingWorkflowAction({ kind: 'declineLink', shareCase, declineReason })
            }
            onSelectCorrectionCase={setSelectedCorrectionShareCaseId}
          />
        </QueryFallback>
      </SectionShell>

      <SectionShell title="患者共有同意" description="共有開始に必要な同意登録と撤回を扱います。">
        <PatientShareConsentsPanel
          shareCases={shareCases}
          selectedShareCaseId={effectiveConsentShareCaseId}
          setSelectedShareCaseId={setSelectedConsentShareCaseId}
          consents={patientShareConsents}
          formMethods={consentFormMethods}
          revokeReasons={consentRevokeReasons}
          setRevokeReasons={setConsentRevokeReasons}
          isLoading={patientShareConsentsQuery.isLoading}
          isError={patientShareConsentsQuery.isError}
          error={patientShareConsentsQuery.error}
          isBusy={isBusy}
          onRetry={() => void patientShareConsentsQuery.refetch()}
          onCreate={() => createPatientShareConsentMutation.mutate()}
          onRevoke={(consent, reason) =>
            setPendingWorkflowAction({
              kind: 'revokePatientShareConsent',
              shareCase: shareCases.find((row) => row.id === consent.share_case_id) ?? null,
              consent,
              reason,
            })
          }
        />
      </SectionShell>

      <SectionShell title="修正依頼" description="共有ケース単位で作成と対応状況を扱います。">
        <CorrectionRequestsPanel
          shareCases={shareCases}
          selectedShareCaseId={effectiveCorrectionShareCaseId}
          setSelectedShareCaseId={setSelectedCorrectionShareCaseId}
          correctionRequests={correctionRequests}
          correctionForm={correctionForm}
          setCorrectionForm={setCorrectionForm}
          isLoading={correctionRequestsQuery.isLoading}
          isError={correctionRequestsQuery.isError}
          error={correctionRequestsQuery.error}
          isBusy={isBusy}
          onRetry={() => void correctionRequestsQuery.refetch()}
          onCreate={() => createCorrectionRequestMutation.mutate()}
        />
      </SectionShell>

      <SectionShell
        title="協力薬局への訪問依頼"
        description="訪問依頼を作成し、受諾・辞退に必要な状態を確認します。"
      >
        <VisitRequestCreatePanel
          activeShareCases={activeShareCases}
          activeShareCaseTotalCount={activeShareCaseTotalCount}
          selectedShareCaseId={effectiveVisitRequestShareCaseId}
          setSelectedShareCaseId={setSelectedVisitRequestShareCaseId}
          form={visitRequestForm}
          setForm={setVisitRequestForm}
          isBusy={isBusy}
          onCreate={() => createVisitRequestMutation.mutate()}
        />
        <QueryFallback
          isLoading={visitRequestsQuery.isLoading}
          isError={visitRequestsQuery.isError}
          error={visitRequestsQuery.error}
          onRetry={() => void visitRequestsQuery.refetch()}
        >
          <VisitRequestsTable
            rows={visitRequests}
            declineReasons={declineReasons}
            setDeclineReasons={setDeclineReasons}
            isBusy={isBusy}
            onAccept={(request) =>
              setPendingWorkflowAction({ kind: 'acceptVisitRequest', request })
            }
            onDecline={(request, declineReason) =>
              setPendingWorkflowAction({
                kind: 'declineVisitRequest',
                request,
                declineReason,
              })
            }
          />
        </QueryFallback>
      </SectionShell>

      <SectionShell
        title="薬局間連携メッセージ"
        description="患者共有ケースまたは訪問依頼単位で連絡します。"
      >
        <MessageThreadsPanel
          activeShareCases={activeShareCases}
          activeShareCaseTotalCount={activeShareCaseTotalCount}
          visitRequests={visitRequests}
          selectedShareCaseId={effectiveMessageShareCaseId}
          setSelectedShareCaseId={setSelectedMessageShareCaseId}
          selectedVisitRequestId={effectiveMessageVisitRequestId}
          setSelectedVisitRequestId={setSelectedMessageVisitRequestId}
          messageThreads={messageThreads}
          form={messageForm}
          setForm={setMessageForm}
          isLoading={messageThreadsQuery.isLoading}
          isError={messageThreadsQuery.isError}
          error={messageThreadsQuery.error}
          isBusy={isBusy}
          onRetry={() => void messageThreadsQuery.refetch()}
          onCreate={() => createMessageMutation.mutate()}
        />
      </SectionShell>

      <SectionShell
        title="協力訪問記録"
        description="提出・確認・差戻し・報告書ドラフト化の状態を扱います。"
      >
        <div className="mb-4">
          <PartnerVisitRecordDraftPanel
            visitRequests={draftableVisitRequests}
            selectedVisitRequestId={effectiveRecordVisitRequestId}
            setSelectedVisitRequestId={setSelectedRecordVisitRequestId}
            form={recordDraftForm}
            setForm={setRecordDraftForm}
            isBusy={isBusy}
            onSave={() => savePartnerVisitRecordDraftMutation.mutate()}
          />
        </div>
        <QueryFallback
          isLoading={partnerVisitRecordsQuery.isLoading}
          isError={partnerVisitRecordsQuery.isError}
          error={partnerVisitRecordsQuery.error}
          onRetry={() => void partnerVisitRecordsQuery.refetch()}
        >
          <PartnerVisitRecordsTable
            rows={partnerVisitRecords}
            returnReasons={returnReasons}
            setReturnReasons={setReturnReasons}
            isBusy={isBusy}
            onSubmit={(record) =>
              setPendingWorkflowAction({ kind: 'submitPartnerVisitRecord', record })
            }
            onConfirm={(record, doctorReportRequired) =>
              setPendingWorkflowAction({
                kind: 'confirmPartnerVisitRecord',
                record,
                doctorReportRequired,
              })
            }
            onReturn={(record, returnReason) =>
              setPendingWorkflowAction({ kind: 'returnPartnerVisitRecord', record, returnReason })
            }
            onCreateReport={(record) =>
              setPendingWorkflowAction({ kind: 'createReportDraft', record })
            }
          />
        </QueryFallback>
      </SectionShell>

      <ConfirmDialog
        open={pendingWorkflowAction !== null}
        onOpenChange={(open) => {
          if (!open) setPendingWorkflowAction(null);
        }}
        title={
          pendingWorkflowAction
            ? workflowActionTitle(pendingWorkflowAction)
            : '薬局間連携を更新します'
        }
        description={
          pendingWorkflowAction
            ? workflowActionDescription(pendingWorkflowAction)
            : '対象が正しいことを確認してください。'
        }
        confirmLabel={
          pendingWorkflowAction ? workflowActionConfirmLabel(pendingWorkflowAction) : '実行する'
        }
        variant={pendingWorkflowAction ? workflowActionVariant(pendingWorkflowAction) : 'default'}
        confirmDisabled={isBusy}
        onConfirm={executePendingWorkflowAction}
      >
        {pendingWorkflowAction ? (
          <ul className="space-y-1 rounded-md border border-border/70 bg-muted/30 p-3 text-sm text-foreground">
            {workflowActionDetails(pendingWorkflowAction).map((detail) => (
              <li key={detail}>{detail}</li>
            ))}
          </ul>
        ) : null}
      </ConfirmDialog>
    </div>
  );
}
