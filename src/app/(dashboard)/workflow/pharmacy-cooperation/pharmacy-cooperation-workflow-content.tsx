'use client';

import type { Dispatch, ReactNode, SetStateAction } from 'react';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/loading';
import { Textarea } from '@/components/ui/textarea';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { cn } from '@/lib/utils';

type CursorPage<T> = {
  data: T[];
  next_cursor?: string | null;
};

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

type LinkAcceptForm = {
  partnerPatientId: string;
  name: string;
  nameKana: string;
  birthDate: string;
  address: string;
  overrideReason: string;
};

type CorrectionTargetType =
  | 'patient_profile'
  | 'care_case'
  | 'management_plan'
  | 'visit_request'
  | 'partner_visit_record'
  | 'claim_note'
  | 'billing_candidate';

type CorrectionRequestType = 'correction' | 'addition';

type CorrectionRequestRow = {
  id: string;
  share_case_id: string;
  target_owner: string;
  target_type: CorrectionTargetType;
  target_id: string | null;
  field_path: string | null;
  request_type: CorrectionRequestType;
  status: string;
  requested_by: string;
  responded_by: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
};

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
  owner_partner_pharmacy: { id: string; name: string; status: string };
  visit_request: { id: string; status: string; urgency: string };
  claim_note: {
    id: string;
    claim_status: string;
    visit_date: string;
    partner_pharmacy_name: string;
    prescription_received_by: string;
    dispensing_pharmacy_name: string;
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

const EMPTY_LINK_ACCEPT_FORM: LinkAcceptForm = {
  partnerPatientId: '',
  name: '',
  nameKana: '',
  birthDate: '',
  address: '',
  overrideReason: '',
};

const CORRECTION_FIELD_OPTIONS: Record<
  CorrectionTargetType,
  Array<{ value: string; label: string }>
> = {
  patient_profile: [
    { value: 'name', label: '氏名' },
    { value: 'name_kana', label: '氏名カナ' },
    { value: 'birth_date', label: '生年月日' },
    { value: 'gender', label: '性別' },
    { value: 'phone', label: '電話' },
    { value: 'allergy_info', label: 'アレルギー' },
    { value: 'notes', label: '備考' },
    { value: 'primary_residence.address', label: '住所' },
    { value: 'primary_residence.unit_name', label: '居室' },
  ],
  care_case: [
    { value: 'referral_source', label: '紹介元' },
    { value: 'referral_date', label: '紹介日' },
    { value: 'start_date', label: '開始日' },
    { value: 'end_date', label: '終了日' },
    { value: 'primary_pharmacist_id', label: '主担当' },
    { value: 'required_visit_support', label: '訪問支援' },
    { value: 'notes', label: '備考' },
  ],
  management_plan: [
    { value: 'content', label: '計画内容' },
    { value: 'goals', label: '目標' },
    { value: 'monitoring_items', label: '確認項目' },
    { value: 'review_schedule', label: '見直し予定' },
  ],
  visit_request: [
    { value: 'request_reason', label: '依頼理由' },
    { value: 'desired_start_at', label: '希望開始' },
    { value: 'desired_end_at', label: '希望終了' },
    { value: 'physician_instruction', label: '医師指示' },
    { value: 'carry_items', label: '持参物' },
    { value: 'patient_home_notes', label: '居宅メモ' },
  ],
  partner_visit_record: [
    { value: 'visit_at', label: '訪問日時' },
    { value: 'pharmacist_id', label: '薬剤師ID' },
    { value: 'pharmacist_name', label: '薬剤師名' },
    { value: 'record_content', label: '記録内容' },
    { value: 'attachments', label: '添付' },
  ],
  claim_note: [
    { value: 'prescription_received_by', label: '処方箋受付' },
    { value: 'dispensing_pharmacy_name', label: '調剤薬局' },
    { value: 'claim_status', label: '請求状態' },
    { value: 'claim_note_text', label: '請求メモ' },
  ],
  billing_candidate: [
    { value: 'billing_status', label: '算定状態' },
    { value: 'exclusion_reason', label: '除外理由' },
    { value: 'amount_snapshot', label: '金額' },
  ],
};

const CORRECTION_TARGET_LABELS: Record<CorrectionTargetType, string> = {
  patient_profile: '患者基本',
  care_case: 'ケース',
  management_plan: '管理計画',
  visit_request: '訪問依頼',
  partner_visit_record: '協力訪問記録',
  claim_note: '請求メモ',
  billing_candidate: '算定候補',
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

async function readApiJson<T>(response: Response): Promise<T> {
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      json && typeof json === 'object' && 'message' in json && typeof json.message === 'string'
        ? json.message
        : '処理に失敗しました';
    throw new Error(message);
  }
  return json as T;
}

async function fetchShareCases(orgId: string) {
  const response = await fetch(
    '/api/patient-share-cases?limit=8&view_context=pharmacy_cooperation_workflow',
    {
      headers: { 'x-org-id': orgId },
    },
  );
  return readApiJson<CursorPage<PatientShareCaseRow>>(response);
}

async function fetchVisitRequests(orgId: string) {
  const response = await fetch('/api/pharmacy-visit-requests?limit=8', {
    headers: { 'x-org-id': orgId },
  });
  return readApiJson<CursorPage<PharmacyVisitRequestRow>>(response);
}

async function fetchPartnerVisitRecords(orgId: string) {
  const response = await fetch('/api/partner-visit-records?limit=8', {
    headers: { 'x-org-id': orgId },
  });
  return readApiJson<CursorPage<PartnerVisitRecordRow>>(response);
}

async function fetchCorrectionRequests(orgId: string, shareCaseId: string) {
  const response = await fetch(
    `/api/patient-share-cases/${shareCaseId}/correction-requests?limit=8`,
    {
      headers: { 'x-org-id': orgId },
    },
  );
  return readApiJson<CursorPage<CorrectionRequestRow>>(response);
}

async function fetchPatientShareConsents(orgId: string, shareCaseId: string) {
  const response = await fetch(`/api/patient-share-cases/${shareCaseId}/consents?limit=8`, {
    headers: { 'x-org-id': orgId },
  });
  return readApiJson<CursorPage<PatientShareConsentRow>>(response);
}

function formatDate(value: string | null | undefined) {
  if (!value) return '-';
  return value.slice(0, 10);
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return '-';
  return value.slice(0, 16).replace('T', ' ');
}

function formatYen(value: number | null | undefined) {
  if (value === null || value === undefined) return '-';
  return `${Math.round(value).toLocaleString('ja-JP')}円`;
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
    pending_partner: '協力薬局待ち',
    active: '共有中',
    suspended: '停止中',
    revoked: '撤回',
    ended: '終了',
    requested: '依頼中',
    accepted: '受諾済み',
    declined: '辞退',
    cancelled: '取消',
    completed: '完了',
    expired: '期限切れ',
    submitted: '提出済み',
    confirmed: '確認済み',
    returned: '差戻し',
    superseded: '置換済み',
    open: '未対応',
    responded: '回答済み',
    resolved: '解決',
  };
  return labels[status] ?? status;
}

function statusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'active' || status === 'accepted' || status === 'confirmed') return 'default';
  if (status === 'declined' || status === 'returned' || status === 'revoked') return 'destructive';
  if (status === 'draft' || status === 'pending_partner') return 'secondary';
  return 'outline';
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
      className="h-10 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
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

function TableFrame({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border/70">
      <table className="min-w-full text-sm" aria-label={label}>
        {children}
      </table>
    </div>
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
  if (isLoading) return <Skeleton className="h-60 rounded-lg" />;
  if (isError) {
    return (
      <ErrorState
        variant="server"
        title="薬局間協力ワークフローを表示できません"
        description="状態一覧の取得に失敗しました。再試行してください。"
        detail={error instanceof Error ? error.message : undefined}
        action={{ label: '再試行', onClick: onRetry }}
      />
    );
  }
  return <>{children}</>;
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
  onActivate: (id: string) => void;
  onBaseApprove: (id: string) => void;
  onAcceptLink: (id: string, form: LinkAcceptForm) => void;
  onDeclineLink: (id: string, reason: string) => void;
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

  return (
    <TableFrame label="患者共有ケース一覧">
      <thead className="bg-muted/60 text-xs text-muted-foreground">
        <tr>
          <th scope="col" className="px-3 py-2 text-left font-medium">
            共有ケース
          </th>
          <th scope="col" className="px-3 py-2 text-left font-medium">
            協力薬局
          </th>
          <th scope="col" className="px-3 py-2 text-left font-medium">
            患者リンク
          </th>
          <th scope="col" className="px-3 py-2 text-left font-medium">
            有効期間
          </th>
          <th scope="col" className="px-3 py-2 text-left font-medium">
            操作
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const acceptForm = linkAcceptForms[row.id] ?? EMPTY_LINK_ACCEPT_FORM;
          const declineReason = linkDeclineReasons[row.id] ?? '';
          const link = row.patient_link;
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
            <tr key={row.id} className="border-t border-border/70 align-top">
              <td className="px-3 py-2">
                <div className="font-medium">{row.id}</div>
                <Badge className="mt-1" variant={statusVariant(row.status)}>
                  {statusLabel(row.status)}
                </Badge>
              </td>
              <td className="px-3 py-2">{row.partnership.partner_pharmacy.name}</td>
              <td className="px-3 py-2">
                <div>{statusLabel(link?.match_status ?? 'pending')}</div>
                <TinyMeta>
                  base {baseApproved ? '承認済み' : '未承認'} / partner{' '}
                  {link?.approved_by_partner ? '承認済み' : '未承認'}
                </TinyMeta>
              </td>
              <td className="px-3 py-2 tabular-nums">
                {formatDate(row.starts_at)} - {formatDate(row.ends_at)}
              </td>
              <td className="min-w-[44rem] px-3 py-2">
                <div className="flex flex-col gap-3">
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={isBusy || !canActivate}
                      onClick={() => onActivate(row.id)}
                    >
                      <CheckCircle2 className="size-4" aria-hidden="true" />
                      共有開始
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={isBusy || !isPendingLink || baseApproved}
                      onClick={() => onBaseApprove(row.id)}
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
                            updateAcceptForm(
                              row.id,
                              { partnerPatientId: event.target.value },
                              acceptForm,
                            )
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
                            updateAcceptForm(
                              row.id,
                              { overrideReason: event.target.value },
                              acceptForm,
                            )
                          }
                          aria-label={`${row.id} の照合補足`}
                        />
                      </label>
                      <div className="flex flex-wrap gap-2 sm:col-span-2 xl:col-span-3">
                        <Button
                          type="button"
                          size="sm"
                          disabled={isBusy || !canAccept}
                          onClick={() => onAcceptLink(row.id, acceptForm)}
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
                          className="min-w-52 flex-1"
                        />
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={isBusy || declineReason.trim().length === 0}
                          onClick={() => onDeclineLink(row.id, declineReason)}
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
              </td>
            </tr>
          );
        })}
      </tbody>
    </TableFrame>
  );
}

function PatientShareConsentsPanel({
  shareCases,
  selectedShareCaseId,
  setSelectedShareCaseId,
  consents,
  form,
  setForm,
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
  form: PatientShareConsentForm;
  setForm: Dispatch<SetStateAction<PatientShareConsentForm>>;
  revokeReasons: Record<string, string>;
  setRevokeReasons: Dispatch<SetStateAction<Record<string, string>>>;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  isBusy: boolean;
  onRetry: () => void;
  onCreate: () => void;
  onRevoke: (consentId: string, reason: string) => void;
}) {
  const selectedShareCase = shareCases.find((row) => row.id === selectedShareCaseId) ?? null;
  const canCreate =
    Boolean(selectedShareCaseId) &&
    Boolean(selectedShareCase) &&
    selectedShareCase?.status !== 'ended' &&
    selectedShareCase?.status !== 'revoked' &&
    form.consentDate.trim().length > 0 &&
    form.consentPerson.trim().length > 0;

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
          <label className="flex flex-col gap-1">
            <FieldLabel>同意日</FieldLabel>
            <Input
              type="date"
              value={form.consentDate}
              onChange={(event) =>
                setForm((current) => ({ ...current, consentDate: event.target.value }))
              }
              aria-label="患者共有同意日"
            />
          </label>
          <label className="flex flex-col gap-1">
            <FieldLabel>同意者</FieldLabel>
            <Input
              value={form.consentPerson}
              onChange={(event) =>
                setForm((current) => ({ ...current, consentPerson: event.target.value }))
              }
              aria-label="患者共有同意者"
            />
          </label>
          <label className="flex flex-col gap-1">
            <FieldLabel>方法</FieldLabel>
            <NativeSelect
              value={form.consentMethod}
              onChange={(value) =>
                setForm((current) => ({
                  ...current,
                  consentMethod: value as PatientShareConsentForm['consentMethod'],
                }))
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
              value={form.consentRecordId}
              onChange={(event) =>
                setForm((current) => ({ ...current, consentRecordId: event.target.value }))
              }
              aria-label="患者共有同意記録ID"
            />
          </label>
          <label className="flex flex-col gap-1">
            <FieldLabel>添付ID</FieldLabel>
            <Input
              value={form.fileAssetId}
              onChange={(event) =>
                setForm((current) => ({ ...current, fileAssetId: event.target.value }))
              }
              aria-label="患者共有同意添付ID"
            />
          </label>
          <label className="flex flex-col gap-1">
            <FieldLabel>有効期限</FieldLabel>
            <Input
              type="date"
              value={form.validUntil}
              onChange={(event) =>
                setForm((current) => ({ ...current, validUntil: event.target.value }))
              }
              aria-label="患者共有同意有効期限"
            />
          </label>
          <label className="flex min-h-10 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.allowPdfOutput}
              onChange={(event) =>
                setForm((current) => ({ ...current, allowPdfOutput: event.target.checked }))
              }
              aria-label="患者共有同意PDF出力"
              className="size-4 rounded border-border"
            />
            PDF出力
          </label>
          <label className="flex min-h-10 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.allowAttachments}
              onChange={(event) =>
                setForm((current) => ({ ...current, allowAttachments: event.target.checked }))
              }
              aria-label="患者共有同意添付閲覧"
              className="size-4 rounded border-border"
            />
            添付閲覧
          </label>
        </div>
        <div className="lg:col-span-2">
          <Button type="button" disabled={isBusy || !canCreate} onClick={onCreate}>
            <CheckCircle2 className="size-4" aria-hidden="true" />
            同意登録
          </Button>
        </div>
      </div>

      <QueryFallback isLoading={isLoading} isError={isError} error={error} onRetry={onRetry}>
        {consents.length === 0 ? (
          <EmptyState title="患者共有同意はまだありません" />
        ) : (
          <TableFrame label="患者共有同意一覧">
            <thead className="bg-muted/60 text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2 text-left font-medium">
                  同意
                </th>
                <th scope="col" className="px-3 py-2 text-left font-medium">
                  状態
                </th>
                <th scope="col" className="px-3 py-2 text-left font-medium">
                  範囲
                </th>
                <th scope="col" className="px-3 py-2 text-left font-medium">
                  操作
                </th>
              </tr>
            </thead>
            <tbody>
              {consents.map((row) => {
                const revokeReason = revokeReasons[row.id] ?? '';
                return (
                  <tr key={row.id} className="border-t border-border/70 align-top">
                    <td className="px-3 py-2">
                      <div className="font-medium">{row.id}</div>
                      <TinyMeta>
                        {formatDate(row.consent_date)} /{' '}
                        {row.consent_method === 'digital' ? 'デジタル' : '紙署名'}
                      </TinyMeta>
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant={row.revoked_at ? 'destructive' : 'default'}>
                        {row.revoked_at ? '撤回済み' : '有効'}
                      </Badge>
                      <div className="mt-1">
                        <TinyMeta>{row.has_file_asset ? '添付あり' : '添付なし'}</TinyMeta>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <TinyMeta>
                        {row.scope_keys.length > 0 ? row.scope_keys.join(', ') : '-'}
                      </TinyMeta>
                    </td>
                    <td className="min-w-64 px-3 py-2">
                      {row.revoked_at ? (
                        <TinyMeta>状態遷移はありません</TinyMeta>
                      ) : (
                        <div className="flex flex-col gap-2">
                          <Input
                            value={revokeReason}
                            onChange={(event) =>
                              setRevokeReasons((current) => ({
                                ...current,
                                [row.id]: event.target.value,
                              }))
                            }
                            placeholder="撤回理由"
                            aria-label={`${row.id} の患者共有同意撤回理由`}
                          />
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={isBusy}
                            onClick={() => onRevoke(row.id, revokeReason)}
                          >
                            <XCircle className="size-4" aria-hidden="true" />
                            撤回
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </TableFrame>
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
  onAccept: (id: string) => void;
  onDecline: (id: string, reason: string) => void;
}) {
  if (rows.length === 0) {
    return <EmptyState title="協力薬局への訪問依頼はまだありません" />;
  }

  return (
    <TableFrame label="協力薬局訪問依頼一覧">
      <thead className="bg-muted/60 text-xs text-muted-foreground">
        <tr>
          <th scope="col" className="px-3 py-2 text-left font-medium">
            依頼
          </th>
          <th scope="col" className="px-3 py-2 text-left font-medium">
            協力薬局
          </th>
          <th scope="col" className="px-3 py-2 text-left font-medium">
            希望日時
          </th>
          <th scope="col" className="px-3 py-2 text-right font-medium">
            見込額
          </th>
          <th scope="col" className="px-3 py-2 text-left font-medium">
            操作
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const declineReason = declineReasons[row.id] ?? '';
          return (
            <tr key={row.id} className="border-t border-border/70">
              <td className="px-3 py-2">
                <div className="font-medium">{row.id}</div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <Badge variant={statusVariant(row.status)}>{statusLabel(row.status)}</Badge>
                  <TinyMeta>{row.urgency}</TinyMeta>
                </div>
              </td>
              <td className="px-3 py-2">{row.partner_pharmacy.name}</td>
              <td className="px-3 py-2 tabular-nums">
                {formatDateTime(row.desired_start_at)}
                {row.desired_end_at ? ` - ${formatDateTime(row.desired_end_at)}` : ''}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {formatYen(row.estimated_amount)}
                <div className="mt-1">
                  <TinyMeta>
                    {row.contract_id ? `契約 ${row.contract_id}` : '契約未確定'}
                    {row.contract_version_id ? ` / 版 ${row.contract_version_id}` : ''}
                  </TinyMeta>
                </div>
                <div className="mt-1">
                  <TinyMeta>
                    {billingModelLabel(row.estimated_snapshot?.billing_model)}
                    {row.estimated_snapshot?.unit_price !== null &&
                    row.estimated_snapshot?.unit_price !== undefined
                      ? ` / 単価 ${formatYen(row.estimated_snapshot.unit_price)}`
                      : ''}
                  </TinyMeta>
                </div>
                <div className="mt-1">
                  <TinyMeta>
                    {estimateStatusLabel(row.estimated_snapshot?.estimate_status)}
                  </TinyMeta>
                </div>
              </td>
              <td className="min-w-72 px-3 py-2">
                {row.status === 'requested' ? (
                  <div className="flex flex-col gap-2">
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        disabled={isBusy}
                        onClick={() => onAccept(row.id)}
                      >
                        <CheckCircle2 className="size-4" aria-hidden="true" />
                        受諾
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={isBusy || declineReason.trim().length === 0}
                        onClick={() => onDecline(row.id, declineReason)}
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
                          [row.id]: event.target.value,
                        }))
                      }
                      placeholder="辞退理由"
                      aria-label={`${row.id} の辞退理由`}
                    />
                  </div>
                ) : (
                  <TinyMeta>状態遷移はありません</TinyMeta>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </TableFrame>
  );
}

function VisitRequestCreatePanel({
  activeShareCases,
  selectedShareCaseId,
  setSelectedShareCaseId,
  form,
  setForm,
  isBusy,
  onCreate,
}: {
  activeShareCases: PatientShareCaseRow[];
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
  onSubmit: (id: string) => void;
  onConfirm: (id: string, doctorReportRequired: boolean) => void;
  onReturn: (id: string, reason: string) => void;
  onCreateReport: (id: string) => void;
}) {
  if (rows.length === 0) {
    return <EmptyState title="協力訪問記録はまだありません" />;
  }

  return (
    <TableFrame label="協力訪問記録一覧">
      <thead className="bg-muted/60 text-xs text-muted-foreground">
        <tr>
          <th scope="col" className="px-3 py-2 text-left font-medium">
            訪問記録
          </th>
          <th scope="col" className="px-3 py-2 text-left font-medium">
            協力薬局
          </th>
          <th scope="col" className="px-3 py-2 text-left font-medium">
            訪問日時
          </th>
          <th scope="col" className="px-3 py-2 text-left font-medium">
            請求メモ
          </th>
          <th scope="col" className="px-3 py-2 text-left font-medium">
            操作
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const returnReason = returnReasons[row.id] ?? '';
          return (
            <tr key={row.id} className="border-t border-border/70">
              <td className="px-3 py-2">
                <div className="font-medium">{row.id}</div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <Badge variant={statusVariant(row.status)}>{statusLabel(row.status)}</Badge>
                  <TinyMeta>rev.{row.revision_no}</TinyMeta>
                </div>
              </td>
              <td className="px-3 py-2">{row.owner_partner_pharmacy.name}</td>
              <td className="px-3 py-2 tabular-nums">{formatDateTime(row.visit_at)}</td>
              <td className="px-3 py-2">
                {row.claim_note ? (
                  <>
                    <div>{statusLabel(row.claim_note.claim_status)}</div>
                    <TinyMeta>{formatDate(row.claim_note.visit_date)}</TinyMeta>
                  </>
                ) : (
                  <TinyMeta>未作成</TinyMeta>
                )}
              </td>
              <td className="min-w-[24rem] px-3 py-2">
                {row.status === 'draft' || row.status === 'returned' ? (
                  <Button
                    type="button"
                    size="sm"
                    disabled={isBusy}
                    onClick={() => onSubmit(row.id)}
                  >
                    <Send className="size-4" aria-hidden="true" />
                    提出
                  </Button>
                ) : row.status === 'submitted' ? (
                  <div className="flex flex-col gap-2">
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        disabled={isBusy}
                        onClick={() => onConfirm(row.id, false)}
                      >
                        <CheckCircle2 className="size-4" aria-hidden="true" />
                        確認
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        disabled={isBusy}
                        onClick={() => onConfirm(row.id, true)}
                      >
                        <FileText className="size-4" aria-hidden="true" />
                        確認+報告
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={isBusy || returnReason.trim().length === 0}
                        onClick={() => onReturn(row.id, returnReason)}
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
                          [row.id]: event.target.value,
                        }))
                      }
                      placeholder="差戻し理由"
                      aria-label={`${row.id} の差戻し理由`}
                    />
                  </div>
                ) : row.status === 'confirmed' ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={isBusy}
                    onClick={() => onCreateReport(row.id)}
                  >
                    <FileText className="size-4" aria-hidden="true" />
                    報告書ドラフト
                  </Button>
                ) : (
                  <TinyMeta>状態遷移はありません</TinyMeta>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </TableFrame>
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
          <TableFrame label="修正依頼一覧">
            <thead className="bg-muted/60 text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2 text-left font-medium">
                  修正依頼
                </th>
                <th scope="col" className="px-3 py-2 text-left font-medium">
                  対象
                </th>
                <th scope="col" className="px-3 py-2 text-left font-medium">
                  状態
                </th>
                <th scope="col" className="px-3 py-2 text-left font-medium">
                  更新
                </th>
              </tr>
            </thead>
            <tbody>
              {correctionRequests.map((row) => (
                <tr key={row.id} className="border-t border-border/70">
                  <td className="px-3 py-2">
                    <div className="font-medium">{row.id}</div>
                    <TinyMeta>{row.request_type === 'addition' ? '追記' : '修正'}</TinyMeta>
                  </td>
                  <td className="px-3 py-2">
                    <div>{CORRECTION_TARGET_LABELS[row.target_type] ?? row.target_type}</div>
                    <TinyMeta>{row.field_path ?? '-'}</TinyMeta>
                  </td>
                  <td className="px-3 py-2">
                    <Badge variant={statusVariant(row.status)}>{statusLabel(row.status)}</Badge>
                  </td>
                  <td className="px-3 py-2 tabular-nums">{formatDateTime(row.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </TableFrame>
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
  const [consentForm, setConsentForm] = useState<PatientShareConsentForm>(
    EMPTY_PATIENT_SHARE_CONSENT_FORM,
  );
  const [consentRevokeReasons, setConsentRevokeReasons] = useState<Record<string, string>>({});
  const [selectedCorrectionShareCaseId, setSelectedCorrectionShareCaseId] = useState('');
  const [correctionForm, setCorrectionForm] = useState<CorrectionForm>(EMPTY_CORRECTION_FORM);
  const [selectedVisitRequestShareCaseId, setSelectedVisitRequestShareCaseId] = useState('');
  const [visitRequestForm, setVisitRequestForm] =
    useState<VisitRequestForm>(EMPTY_VISIT_REQUEST_FORM);
  const [selectedRecordVisitRequestId, setSelectedRecordVisitRequestId] = useState('');
  const [recordDraftForm, setRecordDraftForm] = useState<PartnerVisitRecordDraftForm>(
    EMPTY_PARTNER_VISIT_RECORD_DRAFT_FORM,
  );
  const [lastReportDraft, setLastReportDraft] = useState<ReportDraftResult | null>(null);
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
  const visitRequests = visitRequestsQuery.data?.data ?? [];
  const partnerVisitRecords = partnerVisitRecordsQuery.data?.data ?? [];
  const activeShareCases = shareCases.filter((shareCase) => shareCase.status === 'active');
  const draftableVisitRequests = visitRequests.filter(
    (request) => request.status === 'accepted' || request.status === 'completed',
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
    ]);
  };

  const activateShareCaseMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/patient-share-cases/${id}/activate`, {
        method: 'POST',
        headers: { 'x-org-id': orgId },
      });
      return readApiJson<unknown>(response);
    },
    onSuccess: async () => {
      toast.success('患者共有ケースを共有中にしました');
      await invalidateWorkflow();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '患者共有ケースの有効化に失敗しました');
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
        headers: {
          'content-type': 'application/json',
          'x-org-id': orgId,
        },
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
      toast.error(error instanceof Error ? error.message : '患者リンクの更新に失敗しました');
    },
  });

  const createPatientShareConsentMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(
        `/api/patient-share-cases/${effectiveConsentShareCaseId}/consents`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-org-id': orgId,
          },
          body: JSON.stringify({
            consent_date: consentForm.consentDate,
            consent_person: consentForm.consentPerson,
            consent_method: consentForm.consentMethod,
            scope: {
              pdf_output: consentForm.allowPdfOutput,
              attachments: consentForm.allowAttachments,
            },
            ...(consentForm.consentRecordId.trim()
              ? { consent_record_id: consentForm.consentRecordId.trim() }
              : {}),
            ...(consentForm.fileAssetId.trim()
              ? { file_asset_id: consentForm.fileAssetId.trim() }
              : {}),
            ...(consentForm.validUntil.trim()
              ? { valid_until: consentForm.validUntil.trim() }
              : {}),
          }),
        },
      );
      return readApiJson<PatientShareConsentRow>(response);
    },
    onSuccess: async () => {
      toast.success('患者共有同意を登録しました');
      setConsentForm(EMPTY_PATIENT_SHARE_CONSENT_FORM);
      await invalidateWorkflow();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '患者共有同意の登録に失敗しました');
    },
  });

  const revokePatientShareConsentMutation = useMutation({
    mutationFn: async ({ consentId, reason }: { consentId: string; reason: string }) => {
      const response = await fetch(
        `/api/patient-share-cases/${effectiveConsentShareCaseId}/consents/${consentId}/revoke`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-org-id': orgId,
          },
          body: JSON.stringify(reason.trim() ? { reason: reason.trim() } : {}),
        },
      );
      return readApiJson<unknown>(response);
    },
    onSuccess: async () => {
      toast.success('患者共有同意を撤回しました');
      await invalidateWorkflow();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '患者共有同意の撤回に失敗しました');
    },
  });

  const createCorrectionRequestMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(
        `/api/patient-share-cases/${effectiveCorrectionShareCaseId}/correction-requests`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-org-id': orgId,
          },
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
      return readApiJson<CorrectionRequestRow>(response);
    },
    onSuccess: async () => {
      toast.success('修正依頼を作成しました');
      setCorrectionForm(EMPTY_CORRECTION_FORM);
      await invalidateWorkflow();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '修正依頼の作成に失敗しました');
    },
  });

  const createVisitRequestMutation = useMutation({
    mutationFn: async () => {
      const carryItems = multilineItems(visitRequestForm.carryItems);
      const response = await fetch('/api/pharmacy-visit-requests', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-org-id': orgId,
        },
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
      return readApiJson<PharmacyVisitRequestRow>(response);
    },
    onSuccess: async () => {
      toast.success('訪問依頼を作成しました');
      setVisitRequestForm(EMPTY_VISIT_REQUEST_FORM);
      await invalidateWorkflow();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '訪問依頼の作成に失敗しました');
    },
  });

  const savePartnerVisitRecordDraftMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/partner-visit-records', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-org-id': orgId,
        },
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
      return readApiJson<PartnerVisitRecordRow>(response);
    },
    onSuccess: async () => {
      toast.success('協力訪問記録の下書きを保存しました');
      setRecordDraftForm(EMPTY_PARTNER_VISIT_RECORD_DRAFT_FORM);
      await invalidateWorkflow();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '協力訪問記録の保存に失敗しました');
    },
  });

  const visitRequestDecisionMutation = useMutation({
    mutationFn: async ({
      id,
      decision,
      declineReason,
    }: {
      id: string;
      decision: 'accept' | 'decline';
      declineReason?: string;
    }) => {
      const response = await fetch(`/api/pharmacy-visit-requests/${id}/decision`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-org-id': orgId,
        },
        body: JSON.stringify({
          decision,
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
      toast.error(error instanceof Error ? error.message : '訪問依頼の更新に失敗しました');
    },
  });

  const submitRecordMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/partner-visit-records/${id}/submit`, {
        method: 'POST',
        headers: { 'x-org-id': orgId },
      });
      return readApiJson<unknown>(response);
    },
    onSuccess: async () => {
      toast.success('協力訪問記録を提出しました');
      await invalidateWorkflow();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '協力訪問記録の提出に失敗しました');
    },
  });

  const reviewRecordMutation = useMutation({
    mutationFn: async ({
      id,
      decision,
      returnReason,
      doctorReportRequired,
    }: {
      id: string;
      decision: 'confirm' | 'return';
      returnReason?: string;
      doctorReportRequired?: boolean;
    }) => {
      const response = await fetch(`/api/partner-visit-records/${id}/review`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-org-id': orgId,
        },
        body: JSON.stringify({
          decision,
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
      toast.error(error instanceof Error ? error.message : '協力訪問記録の更新に失敗しました');
    },
  });

  const createReportDraftMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/partner-visit-records/${id}/physician-report-draft`, {
        method: 'POST',
        headers: { 'x-org-id': orgId },
      });
      return readApiJson<ReportDraftResult>(response);
    },
    onSuccess: async (result) => {
      setLastReportDraft(result);
      toast.success(result.message);
      await invalidateWorkflow();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '報告書ドラフトの作成に失敗しました');
    },
  });

  const isBusy =
    activateShareCaseMutation.isPending ||
    patientLinkMutation.isPending ||
    createPatientShareConsentMutation.isPending ||
    revokePatientShareConsentMutation.isPending ||
    createCorrectionRequestMutation.isPending ||
    createVisitRequestMutation.isPending ||
    savePartnerVisitRecordDraftMutation.isPending ||
    visitRequestDecisionMutation.isPending ||
    submitRecordMutation.isPending ||
    reviewRecordMutation.isPending ||
    createReportDraftMutation.isPending;

  const correctionRequests = correctionRequestsQuery.data?.data ?? [];
  const patientShareConsents = patientShareConsentsQuery.data?.data ?? [];
  const submittedRecords = partnerVisitRecords.filter((record) => record.status === 'submitted');
  const requestedVisits = visitRequests.filter((request) => request.status === 'requested');
  const inactiveShareCases = shareCases.filter((shareCase) => shareCase.status !== 'active');

  return (
    <div className="space-y-6" data-testid="pharmacy-cooperation-workflow">
      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-lg border border-border/70 bg-card p-4">
          <p className="text-sm font-semibold text-foreground">有効化待ち共有</p>
          <p className="mt-1 text-[26px] font-bold leading-9 tabular-nums">
            {inactiveShareCases.length}
          </p>
          <TinyMeta>共有ケース {shareCases.length} 件</TinyMeta>
        </div>
        <div className="rounded-lg border border-border/70 bg-card p-4">
          <p className="text-sm font-semibold text-foreground">依頼中の訪問</p>
          <p className="mt-1 text-[26px] font-bold leading-9 tabular-nums">
            {requestedVisits.length}
          </p>
          <TinyMeta>訪問依頼 {visitRequests.length} 件</TinyMeta>
        </div>
        <div className="rounded-lg border border-border/70 bg-card p-4">
          <p className="text-sm font-semibold text-foreground">確認待ち記録</p>
          <p className="mt-1 text-[26px] font-bold leading-9 tabular-nums">
            {submittedRecords.length}
          </p>
          <TinyMeta>協力訪問記録 {partnerVisitRecords.length} 件</TinyMeta>
        </div>
      </div>

      {lastReportDraft ? (
        <div
          className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-950"
          data-testid="pharmacy-cooperation-report-result"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-semibold">報告書ドラフト: {lastReportDraft.report.id}</p>
              <p className="mt-1 text-emerald-900">
                {lastReportDraft.reused_existing_draft ? '既存ドラフトを再利用' : '新規作成'} /{' '}
                {statusLabel(lastReportDraft.report.status)}
              </p>
            </div>
            <a
              href={`/reports/${lastReportDraft.report.id}`}
              className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'bg-card')}
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
            onActivate={(id) => activateShareCaseMutation.mutate(id)}
            onBaseApprove={(id) => patientLinkMutation.mutate({ id, decision: 'base_approve' })}
            onAcceptLink={(id, acceptForm) =>
              patientLinkMutation.mutate({ id, decision: 'accept', acceptForm })
            }
            onDeclineLink={(id, declineReason) =>
              patientLinkMutation.mutate({ id, decision: 'decline', declineReason })
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
          form={consentForm}
          setForm={setConsentForm}
          revokeReasons={consentRevokeReasons}
          setRevokeReasons={setConsentRevokeReasons}
          isLoading={patientShareConsentsQuery.isLoading}
          isError={patientShareConsentsQuery.isError}
          error={patientShareConsentsQuery.error}
          isBusy={isBusy}
          onRetry={() => void patientShareConsentsQuery.refetch()}
          onCreate={() => createPatientShareConsentMutation.mutate()}
          onRevoke={(consentId, reason) =>
            revokePatientShareConsentMutation.mutate({ consentId, reason })
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
            onAccept={(id) => visitRequestDecisionMutation.mutate({ id, decision: 'accept' })}
            onDecline={(id, declineReason) =>
              visitRequestDecisionMutation.mutate({
                id,
                decision: 'decline',
                declineReason,
              })
            }
          />
        </QueryFallback>
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
            onSubmit={(id) => submitRecordMutation.mutate(id)}
            onConfirm={(id, doctorReportRequired) =>
              reviewRecordMutation.mutate({
                id,
                decision: 'confirm',
                doctorReportRequired,
              })
            }
            onReturn={(id, returnReason) =>
              reviewRecordMutation.mutate({ id, decision: 'return', returnReason })
            }
            onCreateReport={(id) => createReportDraftMutation.mutate(id)}
          />
        </QueryFallback>
      </SectionShell>
    </div>
  );
}
