'use client';

import { useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';
import { AlertTriangle, Send, FileText, Clock, Pencil, Printer, Share2 } from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';
import { getReportDetailShortcutLinks } from '@/components/features/workflow/page-shortcut-presets';
import { WorkflowPageIntro } from '@/components/features/workflow/workflow-page-intro';
import { PatientHeader } from '@/components/features/patients/patient-header';
import { Button, buttonVariants } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { ErrorState } from '@/components/ui/error-state';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Loading } from '@/components/ui/loading';
import { buildOrgHeaders, buildOrgJsonHeaders } from '@/lib/api/org-headers';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { createClientIdempotencyKey } from '@/lib/idempotency/client-key';
import { buildCareReportApiPath } from '@/lib/reports/api-paths';
import type { PatientArchiveSummary } from '@/lib/patient/archive-summary';
import { buildReportHref } from '@/lib/reports/navigation';
import { formatDateLabel } from '@/lib/ui/date-format';
import {
  REPORT_TYPE_LABELS,
  REPORT_STATUS_CONFIG,
  CHANNEL_LABELS,
} from '@/lib/constants/status-labels';
import { PhysicianReportView } from '@/components/features/reports/physician-report-view';
import { CareManagerReportView } from '@/components/features/reports/care-manager-report-view';
import { ReportEditForm } from '@/components/features/reports/report-edit-form';
import {
  ComplianceChecklist,
  deriveReportComplianceChecks,
} from '@/components/features/reports/compliance-checklist';
import {
  VisitReportReadinessPanel,
  type VisitReportReadinessItem,
} from '@/components/features/visits/visit-report-readiness-panel';
import { PatientCareTeamSourcePanel } from '@/components/features/visits/patient-care-team-source-panel';
import type {
  PhysicianReportContent,
  CareManagerReportContent,
  AudienceReportContent,
} from '@/types/care-report-content';
import type { CareReportActionPermissions } from '@/types/care-report-permissions';
import { ReportAiDraftReview } from './report-ai-draft-review';
import { PageScaffold } from '@/components/layout/page-scaffold';
import { WorkflowBackLink } from '@/components/features/workflow/workflow-back-link';
import {
  readReportBillingContext,
  readReportContentObject,
  readReportWarnings,
} from '@/lib/reports/report-content';
import {
  CARE_REPORT_SEND_CHANNELS,
  normalizeCareReportRecipientRole,
  validateCareReportSendRecipientForm,
  type CareReportSendFormErrors,
} from '@/lib/reports/care-report-send-validation';
import { inferCareReportTargetRole } from '@/lib/reports/care-report-target-role';
import { cn } from '@/lib/utils';
import { messageFromError } from '@/lib/utils/error-message';

// --- Types ---

type DeliveryRecord = {
  id: string;
  channel: string;
  recipient_name: string;
  recipient_contact: string;
  status: string;
  sent_at: string | null;
  created_at: string;
};

type CareReport = {
  id: string;
  patient_id: string;
  case_id?: string | null;
  patient_summary?: {
    id: string;
    name: string | null;
    name_kana: string | null;
    birth_date: string | null;
    archive?: PatientArchiveSummary | null;
  } | null;
  visit_summary?: {
    id: string;
    visit_date: string;
  } | null;
  report_type: string;
  status: string;
  // API は canReport で到達可だが、can_edit/can_send のいずれも持たない場合は
  // content を応答に含めない(閲覧のみでは本文を返さない設計)。FE は欠落を型で表現する。
  content?: PhysicianReportContent | CareManagerReportContent | AudienceReportContent;
  pdf_url: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  delivery_records: DeliveryRecord[];
  prescriber_institution_suggestion?: {
    id: string;
    name: string;
    phone: string | null;
    fax: string | null;
    address: string | null;
    recommended_channels: string[];
    prescribed_date: string;
    prescriber_name: string | null;
  } | null;
  external_professional_suggestions?: ExternalProfessionalSuggestion[];
  delivery_rule_suggestion?: {
    document_type: string;
    target_role: string;
    channel: string;
    fallback_channels: string[];
  } | null;
  permissions?: CareReportActionPermissions;
};

type SendFormData = {
  channel: string;
  recipient_name: string;
  recipient_contact: string;
  recipient_role: string;
};

type SendRequestData = SendFormData & {
  expected_updated_at: string;
  safety_ack: true;
};

// p0_28: 一括送付。共有先(複数)をまとめて送付する。
type BulkSendRequestData = {
  recipients: SendFormData[];
  expected_updated_at: string;
  safety_ack: true;
};

// 共有先の送付候補(処方元医療機関 / 他職種マスター / 患者ケアチーム)
type ShareTarget = {
  id: string;
  label: string;
  audience: string;
  channel: string;
  recipient_name: string;
  recipient_contact: string;
  recipient_role: string;
};

// 送付前チェックの4ガバナンス項目(design p0_28: 薬剤師確認済み / 宛先が設定済み /
// 添付資料あり / 患者情報の出しすぎなし)。key は内部状態用。
const PRE_SEND_CHECK_ITEMS = [
  {
    key: 'content',
    label: '薬剤師確認済み',
    description: '薬剤師が報告内容を確認しました',
  },
  {
    key: 'recipient',
    label: '宛先が設定済み',
    description: '共有先・連絡先・送付方法が設定されているか確認しました',
  },
  {
    key: 'channel',
    label: '添付資料あり',
    description: '必要な添付資料が揃っているか確認しました',
  },
  {
    key: 'consent',
    label: '患者情報の出しすぎなし',
    description: '不要な患者情報・同意外の情報を含めていないか確認しました',
  },
] as const;

type PreSendCheckKey = (typeof PRE_SEND_CHECK_ITEMS)[number]['key'];

// 他職種の職種タイプを共有先の表示ラベル(医師/ケアマネ/訪問看護/施設/家族)へ寄せる。
const PROFESSION_AUDIENCE_LABELS: Record<string, string> = {
  physician: '医師',
  doctor: '医師',
  care_manager: 'ケアマネ',
  visiting_nurse: '訪問看護',
  nurse: '訪問看護',
  facility: '施設',
  family: '家族',
};

type SendFormErrors = CareReportSendFormErrors;

type CareReportDirectSendChannel = (typeof CARE_REPORT_SEND_CHANNELS)[number];
const CARE_REPORT_SEND_CHANNEL_SET = new Set<string>(CARE_REPORT_SEND_CHANNELS);
function isCareReportDirectSendChannel(
  value: string | null | undefined,
): value is CareReportDirectSendChannel {
  return typeof value === 'string' && CARE_REPORT_SEND_CHANNEL_SET.has(value);
}

function buildSendFormFromDeliveryRecord(
  reportType: string,
  delivery: DeliveryRecord,
): SendFormData {
  return {
    channel: isCareReportDirectSendChannel(delivery.channel) ? delivery.channel : 'email',
    recipient_name: delivery.recipient_name,
    recipient_contact: delivery.recipient_contact,
    recipient_role: inferCareReportTargetRole(reportType),
  };
}

type ExternalProfessionalSuggestion = {
  id: string;
  name: string;
  profession_type: string;
  organization_name: string | null;
  department: string | null;
  phone: string | null;
  email: string | null;
  fax: string | null;
  address: string | null;
  preferred_contact_method: string | null;
  preferred_contact_time: string | null;
  last_contacted_at: string | null;
  last_success_channel: string | null;
  recommended_channels: string[];
  is_primary: boolean;
  source?: 'patient_care_team' | 'external_professional_master';
};

function isStringRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readStringField(value: Record<string, unknown> | null, field: string) {
  const fieldValue = value?.[field];
  return typeof fieldValue === 'string' && fieldValue.trim() ? fieldValue : null;
}

function hasStringFields(value: unknown, fields: string[]) {
  if (!isStringRecord(value)) return false;
  return fields.every((field) => typeof value[field] === 'string');
}

function hasReportWarnings(value: Record<string, unknown>) {
  return Array.isArray(value.warnings) && value.warnings.every((item) => typeof item === 'string');
}

function isPhysicianReportContent(content: unknown): content is PhysicianReportContent {
  const value = readReportContentObject(content);
  if (!value) return false;

  return (
    hasStringFields(value.patient, ['name', 'birth_date', 'gender']) &&
    typeof value.report_date === 'string' &&
    typeof value.visit_date === 'string' &&
    typeof value.pharmacist_name === 'string' &&
    hasStringFields(value.prescriber, ['name', 'institution']) &&
    Array.isArray(value.prescriptions) &&
    isStringRecord(value.medication_management) &&
    typeof value.medication_management.compliance_summary === 'string' &&
    typeof value.medication_management.adherence_score === 'number' &&
    typeof value.medication_management.self_management === 'string' &&
    typeof value.medication_management.calendar_used === 'boolean' &&
    isStringRecord(value.adverse_events) &&
    typeof value.adverse_events.has_events === 'boolean' &&
    Array.isArray(value.adverse_events.events) &&
    isStringRecord(value.functional_assessment) &&
    hasStringFields(value.functional_assessment, [
      'sleep',
      'cognition',
      'diet_oral',
      'mobility',
      'excretion',
    ]) &&
    Array.isArray(value.residual_medications) &&
    typeof value.assessment === 'string' &&
    typeof value.plan === 'string' &&
    typeof value.physician_communication === 'string' &&
    hasReportWarnings(value)
  );
}

function isCareManagerReportContent(content: unknown): content is CareManagerReportContent {
  const value = readReportContentObject(content);
  if (!value) return false;

  return (
    hasStringFields(value.patient, ['name', 'birth_date']) &&
    hasStringFields(value.care_manager, ['name', 'organization']) &&
    typeof value.report_date === 'string' &&
    typeof value.visit_date === 'string' &&
    typeof value.pharmacist_name === 'string' &&
    isStringRecord(value.medication_management_summary) &&
    typeof value.medication_management_summary.total_drugs === 'number' &&
    typeof value.medication_management_summary.compliance_summary === 'string' &&
    typeof value.medication_management_summary.self_management === 'string' &&
    typeof value.medication_management_summary.calendar_used === 'boolean' &&
    isStringRecord(value.functional_impact) &&
    hasStringFields(value.functional_impact, [
      'sleep_impact',
      'cognition_impact',
      'diet_impact',
      'mobility_impact',
      'excretion_impact',
    ]) &&
    isStringRecord(value.residual_status) &&
    typeof value.residual_status.summary === 'string' &&
    Array.isArray(value.residual_status.reduction_proposals) &&
    isStringRecord(value.care_service_coordination) &&
    typeof value.care_service_coordination.medication_assistance === 'string' &&
    typeof value.care_service_coordination.unit_dose_packaging === 'boolean' &&
    typeof value.care_service_coordination.calendar_recommendation === 'boolean' &&
    typeof value.care_service_coordination.other_items === 'string' &&
    isStringRecord(value.next_visit_plan) &&
    Array.isArray(value.next_visit_plan.followup_items) &&
    hasReportWarnings(value)
  );
}

function isAudienceReportContent(content: unknown): content is AudienceReportContent {
  const value = readReportContentObject(content);
  return (
    value != null &&
    (value.report_audience === 'visiting_nurse' ||
      value.report_audience === 'facility' ||
      value.report_audience === 'family') &&
    hasStringFields(value.patient, ['name', 'birth_date']) &&
    typeof value.report_date === 'string' &&
    typeof value.visit_date === 'string' &&
    typeof value.pharmacist_name === 'string' &&
    typeof value.summary === 'string' &&
    typeof value.medication === 'string' &&
    typeof value.residual === 'string' &&
    typeof value.evaluation === 'string' &&
    typeof value.requests === 'string' &&
    hasReportWarnings(value)
  );
}

function AudienceReportView({ content }: { content: AudienceReportContent }) {
  const sections = [
    ['今日の要点', content.summary],
    ['服薬状況', content.medication],
    ['残薬', content.residual],
    ['薬剤師の評価', content.evaluation],
    ['お願いしたいこと', content.requests],
  ] as const;
  return (
    <Card data-testid="audience-report-view">
      <CardHeader>
        <CardTitle className="text-base">
          {content.report_audience === 'visiting_nurse'
            ? '訪問看護向け服薬情報共有'
            : content.report_audience === 'family'
              ? 'ご家族向け服薬情報共有'
              : '施設向け服薬介助申し送り'}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {sections.map(([title, body]) => (
          <section
            key={title}
            className="rounded-md border border-border/70 bg-background px-4 py-3"
          >
            <h3 className="text-sm font-semibold text-foreground">{title}</h3>
            <p className="mt-1 whitespace-pre-line text-sm leading-6 text-muted-foreground">
              {body.trim() || '未入力です。'}
            </p>
          </section>
        ))}
      </CardContent>
    </Card>
  );
}

// 送付候補(処方元医療機関 / 他職種)から送付チャネルと連絡先を解決する純粋関数。
// 単一送付ダイアログと p0_28 コンポーザーの共有先で同じ解決ロジックを使う。
function resolveSuggestionDelivery(
  type: 'institution' | 'professional',
  suggestion: {
    name: string;
    phone: string | null;
    fax: string | null;
    email?: string | null;
    recommended_channels?: string[] | null;
    prescriber_name?: string | null;
    preferred_contact_method?: string | null;
  },
  deliveryRule: { channel: string; fallback_channels: string[] } | null,
  recipientRole: string,
): SendFormData {
  const suggestedChannels = [
    deliveryRule?.channel,
    ...(deliveryRule?.fallback_channels ?? []),
    ...(suggestion.recommended_channels ?? []),
  ].filter(isCareReportDirectSendChannel);
  const preferredContactMethod = isCareReportDirectSendChannel(suggestion.preferred_contact_method)
    ? suggestion.preferred_contact_method
    : null;

  const contactByChannel = (ch: string): string | null => {
    if (ch === 'email' || ch === 'ses') return suggestion.email ?? null;
    if (ch === 'fax') return suggestion.fax ?? null;
    if (ch === 'phone') return suggestion.phone ?? null;
    return null;
  };

  const hasContact = (ch: string): boolean => Boolean(contactByChannel(ch));

  let resolvedChannel: string;
  if (type === 'institution') {
    resolvedChannel =
      suggestedChannels.find((ch) => (ch === 'fax' || ch === 'phone' ? hasContact(ch) : false)) ??
      (suggestion.fax ? 'fax' : 'phone');
  } else {
    resolvedChannel =
      suggestedChannels.find(hasContact) ??
      preferredContactMethod ??
      (suggestion.email ? 'email' : suggestion.fax ? 'fax' : suggestion.phone ? 'phone' : 'email');
  }

  const resolvedContact =
    contactByChannel(resolvedChannel) ??
    (type === 'professional' ? (suggestion.email ?? suggestion.fax ?? suggestion.phone ?? '') : '');

  return {
    channel: resolvedChannel,
    recipient_name: (type === 'institution' ? suggestion.prescriber_name : null) ?? suggestion.name,
    recipient_contact: resolvedContact,
    recipient_role: recipientRole,
  };
}

// --- Main ---

export default function ReportDetailPage() {
  const { id } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const orgId = useOrgId();
  const isBootstrappingOrg = !orgId;
  const queryClient = useQueryClient();
  const requestedReportAction = searchParams.get('action');
  const requestedDeliveryId = searchParams.get('delivery_id');
  const requestedSendDialogKey =
    requestedReportAction === 'send' || requestedReportAction === 'resend'
      ? `${requestedReportAction}:${requestedDeliveryId ?? ''}`
      : null;

  const [sendDialogOpen, setSendDialogOpen] = useState(false);
  const [dismissedSendDialogKey, setDismissedSendDialogKey] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [sendForm, setSendForm] = useState<SendFormData>({
    channel: 'email',
    recipient_name: '',
    recipient_contact: '',
    recipient_role: 'physician',
  });
  const [sendSafetyAck, setSendSafetyAck] = useState(false);
  const [sendFormErrors, setSendFormErrors] = useState<SendFormErrors>({});

  // p0_28: 報告書コンポーザー(共有先の複数選択 + 送付前チェック)
  const [composerOpen, setComposerOpen] = useState(false);
  const [selectedTargetIds, setSelectedTargetIds] = useState<string[]>([]);
  const [preSendChecks, setPreSendChecks] = useState<Record<PreSendCheckKey, boolean>>({
    recipient: false,
    content: false,
    consent: false,
    channel: false,
  });

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['care-report', id, orgId],
    queryFn: async () => {
      const res = await fetch(buildCareReportApiPath(id), {
        headers: buildOrgHeaders(orgId),
      });
      if (!res.ok) throw new Error('報告書の取得に失敗しました');
      return res.json() as Promise<{ data: CareReport }>;
    },
    enabled: !!orgId && !!id,
  });

  const report = data?.data;
  const canSendReportForSupportQuery = report?.permissions?.can_send === true;
  const externalProfessionalSuggestionsQuery = useQuery({
    queryKey: [
      'care-report-external-professionals',
      id,
      orgId,
      report?.patient_id,
      report?.case_id,
    ],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (report?.patient_id) {
        params.set('patient_id', report.patient_id);
      }
      if (report?.case_id) {
        params.set('case_id', report.case_id);
      }
      const res = await fetch(`/api/external-professionals/suggestions?${params.toString()}`, {
        headers: buildOrgHeaders(orgId),
      });
      if (!res.ok) throw new Error('他職種候補の取得に失敗しました');
      return res.json() as Promise<{ data: ExternalProfessionalSuggestion[] }>;
    },
    enabled: !!orgId && !!report?.patient_id && canSendReportForSupportQuery,
  });

  // p1_04: AI 下書きの薬剤師確認(draft → confirmed)
  const confirmDraftMutation = useMutation({
    mutationFn: async () => {
      if (!report?.updated_at) {
        throw new Error('報告書の版情報を取得できませんでした。再読み込みしてください');
      }
      const res = await fetch(buildCareReportApiPath(id), {
        method: 'PATCH',
        headers: buildOrgJsonHeaders(orgId),
        body: JSON.stringify({ expected_updated_at: report.updated_at, status: 'confirmed' }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(
          (err as { message?: string } | null)?.message ?? '薬剤師確認の保存に失敗しました',
        );
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success('薬剤師確認済みにしました');
      queryClient.invalidateQueries({ queryKey: ['care-report', id, orgId] });
      queryClient.invalidateQueries({ queryKey: ['care-reports'] });
    },
    onError: (err: Error) => toast.error(messageFromError(err, '薬剤師確認の保存に失敗しました')),
  });

  const sendMutation = useMutation({
    mutationFn: async (formData: SendRequestData) => {
      const res = await fetch(buildCareReportApiPath(id, '/send'), {
        method: 'POST',
        headers: buildOrgJsonHeaders(orgId, {
          'Idempotency-Key': createClientIdempotencyKey('care-report-send'),
        }),
        body: JSON.stringify(formData),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error((err as { message?: string } | null)?.message ?? '送付に失敗しました');
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success('報告書を送付しました');
      if (requestedSendDialogKey) {
        setDismissedSendDialogKey(requestedSendDialogKey);
      }
      setSendDialogOpen(false);
      setSendForm({
        channel: 'email',
        recipient_name: '',
        recipient_contact: '',
        recipient_role: inferCareReportTargetRole(data?.data?.report_type ?? 'physician_report'),
      });
      setSendSafetyAck(false);
      setSendFormErrors({});
      queryClient.invalidateQueries({ queryKey: ['care-report', id, orgId] });
      queryClient.invalidateQueries({ queryKey: ['care-reports'] });
    },
    onError: (err: Error) => toast.error(messageFromError(err, '送付に失敗しました')),
  });

  // p0_28: 一括送付。選択した共有先すべてに送付する。
  const bulkSendMutation = useMutation({
    mutationFn: async (requestData: BulkSendRequestData) => {
      const res = await fetch(buildCareReportApiPath(id, '/send'), {
        method: 'POST',
        headers: buildOrgJsonHeaders(orgId, {
          'Idempotency-Key': createClientIdempotencyKey('care-report-send'),
        }),
        body: JSON.stringify(requestData),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error((err as { message?: string } | null)?.message ?? '一括送付に失敗しました');
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success('報告書を共有先へ送付しました');
      setComposerOpen(false);
      setSelectedTargetIds([]);
      setPreSendChecks({ recipient: false, content: false, consent: false, channel: false });
      queryClient.invalidateQueries({ queryKey: ['care-report', id, orgId] });
      queryClient.invalidateQueries({ queryKey: ['care-reports'] });
    },
    onError: (err: Error) => toast.error(messageFromError(err, '一括送付に失敗しました')),
  });

  function handleSend() {
    if (!report) {
      toast.error('報告書を読み込んでから送付してください');
      return;
    }
    if (!canSendReport) {
      toast.error('報告書の送付権限がありません');
      return;
    }

    const normalizedForm = {
      channel: effectiveSendForm.channel,
      recipient_name: effectiveSendForm.recipient_name.trim(),
      recipient_contact: effectiveSendForm.recipient_contact.trim(),
      recipient_role: effectiveSendForm.recipient_role,
    };
    const validation = validateCareReportSendRecipientForm(normalizedForm);
    const nextErrors: SendFormErrors = validation.ok ? {} : validation.errors;
    if (!sendSafetyAck) {
      nextErrors.safety_ack = '患者、送付先、チャネルを確認してください';
    }

    setSendFormErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      toast.error('送付前の確認項目を見直してください');
      return;
    }
    if (!validation.ok) return;
    sendMutation.mutate({
      ...validation.recipient,
      expected_updated_at: report.updated_at,
      safety_ack: true,
    });
  }

  function handleBulkSend(targets: ShareTarget[]) {
    if (!report) {
      toast.error('報告書を読み込んでから送付してください');
      return;
    }
    if (!canSendReport) {
      toast.error('報告書の送付権限がありません');
      return;
    }

    const selectedTargets = targets.filter((target) =>
      effectiveSelectedTargetIds.includes(target.id),
    );
    if (selectedTargets.length === 0) {
      toast.error('共有先を1件以上選択してください');
      return;
    }
    if (!allPreSendChecksDone) {
      toast.error('送付前チェックをすべて確認してください');
      return;
    }
    bulkSendMutation.mutate({
      recipients: selectedTargets.map((target) => ({
        channel: target.channel,
        recipient_name: target.recipient_name,
        recipient_contact: target.recipient_contact,
        recipient_role: target.recipient_role,
      })),
      expected_updated_at: report.updated_at,
      safety_ack: true,
    });
  }

  if (isBootstrappingOrg || isLoading) {
    return (
      <PageScaffold>
        <WorkflowBackLink href="/reports" label="報告書一覧へ戻る" className="mb-3" />
        <Loading />
      </PageScaffold>
    );
  }

  if (error) {
    return (
      <PageScaffold>
        <WorkflowBackLink href="/reports" label="報告書一覧へ戻る" className="mb-3" />
        <Alert className="border-transparent bg-state-confirm/10 text-state-confirm">
          <AlertTriangle className="size-4 text-state-confirm" aria-hidden="true" />
          <AlertTitle>報告書を取得できませんでした</AlertTitle>
          <AlertDescription className="text-state-confirm">
            通信状態または権限を確認して、再読み込みしてください。
          </AlertDescription>
        </Alert>
        <Button
          type="button"
          variant="outline"
          className="mt-4 bg-background"
          onClick={() => void refetch()}
        >
          再読み込み
        </Button>
      </PageScaffold>
    );
  }

  if (!report) {
    return (
      <PageScaffold>
        <p className="text-sm text-muted-foreground">報告書が見つかりません</p>
      </PageScaffold>
    );
  }

  const statusCfg = REPORT_STATUS_CONFIG[report.status];
  const canEditReport = report.permissions?.can_edit === true;
  const canSendReport = report.permissions?.can_send === true;
  const canCreateExternalShare = report.permissions?.can_create_external_share === true;
  const canUseDeliverySupport = canSendReport;
  const canOutputReport = canSendReport;
  const isShareableReport = ['confirmed', 'sent', 'failed', 'response_waiting'].includes(
    report.status,
  );
  const canUseExternalShare = canSendReport && canCreateExternalShare && isShareableReport;
  const canViewPatientShortcut = report.permissions?.can_view_patient === true;
  const canViewRelatedRequestsShortcut = report.permissions?.can_view_related_requests === true;
  const reportShortcutLinks = getReportDetailShortcutLinks(
    report.patient_id ?? null,
    report.id,
  ).filter((shortcut) => {
    if (shortcut.label === '患者詳細') {
      return canViewPatientShortcut;
    }
    if (shortcut.label === '関連依頼') {
      return canViewRelatedRequestsShortcut;
    }
    return true;
  });
  const isPhysician = report.report_type === 'physician_report';
  const isCareManager = report.report_type === 'care_manager_report';
  const isAudienceReport =
    report.report_type === 'nurse_share' ||
    report.report_type === 'facility_handoff' ||
    report.report_type === 'family_share';
  const hasPhysicianContent = isPhysician && isPhysicianReportContent(report.content);
  const hasCareManagerContent = isCareManager && isCareManagerReportContent(report.content);
  const hasAudienceContent = isAudienceReport && isAudienceReportContent(report.content);
  const hasContentView = hasPhysicianContent || hasCareManagerContent || hasAudienceContent;
  // hasContentView と等価な条件を型ガードの三項演算子で再表現し、content を
  // `PhysicianReportContent | CareManagerReportContent | AudienceReportContent`
  // へ絞り込む(content が optional 化されたため、絞り込みなしの直接参照は型エラーになる)。
  const viewableReportContent:
    | PhysicianReportContent
    | CareManagerReportContent
    | AudienceReportContent
    | null =
    isPhysician && isPhysicianReportContent(report.content)
      ? report.content
      : isCareManager && isCareManagerReportContent(report.content)
        ? report.content
        : isAudienceReport && isAudienceReportContent(report.content)
          ? report.content
          : null;
  // A1-CRC: canReport のみ(canEditReport/canSendReport とも false)のロールは API が
  // content を応答から省く(route.ts の canLoadEditableContent 判定)。この場合は
  // 「構造化データが壊れている」ではなく「閲覧権限がない」ことを明示する。
  const isContentHiddenByPermission =
    report.content === undefined && !canEditReport && !canSendReport;
  const isConfirmedReport = report.status === 'confirmed';
  const isRetryableReport = report.status === 'failed' || report.status === 'response_waiting';
  const canSendReportStatus = isConfirmedReport || isRetryableReport;
  const editableReportContent: PhysicianReportContent | CareManagerReportContent | null =
    isPhysician && isPhysicianReportContent(report.content)
      ? report.content
      : isCareManager && isCareManagerReportContent(report.content)
        ? report.content
        : null;
  const canEditCurrentDraft =
    canEditReport && report.status === 'draft' && editableReportContent !== null;
  const isEditingReport = editMode && canEditCurrentDraft;
  const reportContentObject = readReportContentObject(report.content);
  const contentPatient = isStringRecord(reportContentObject?.patient)
    ? reportContentObject.patient
    : null;
  const patientName = report.patient_summary?.name ?? readStringField(contentPatient, 'name');
  const patientKana = report.patient_summary?.name_kana ?? null;
  const patientBirthDate =
    report.patient_summary?.birth_date ?? readStringField(contentPatient, 'birth_date');
  const visitDate =
    report.visit_summary?.visit_date ?? readStringField(reportContentObject, 'visit_date');
  const requestedDeliveryRecord = requestedDeliveryId
    ? (report.delivery_records.find((record) => record.id === requestedDeliveryId) ?? null)
    : null;
  const requestedSendForm =
    requestedDeliveryRecord && requestedReportAction === 'resend'
      ? buildSendFormFromDeliveryRecord(report.report_type, requestedDeliveryRecord)
      : null;
  const hasValidRequestedSendAction =
    requestedReportAction === 'send' ||
    (requestedReportAction === 'resend' && requestedDeliveryRecord !== null);
  const shouldOpenSendDialogFromQuery = Boolean(
    requestedSendDialogKey &&
    hasValidRequestedSendAction &&
    dismissedSendDialogKey !== requestedSendDialogKey &&
    hasContentView &&
    canSendReportStatus &&
    canSendReport,
  );
  const isQuerySendDialogOpen = shouldOpenSendDialogFromQuery && !sendDialogOpen;
  const effectiveSendForm =
    isQuerySendDialogOpen && requestedSendForm ? requestedSendForm : sendForm;
  const isSendDialogOpen = sendDialogOpen || shouldOpenSendDialogFromQuery;
  const recipientNameForConfirmation = effectiveSendForm.recipient_name.trim() || '未入力';
  const recipientContactForConfirmation = effectiveSendForm.recipient_contact.trim() || '未入力';
  const channelLabel = CHANNEL_LABELS[effectiveSendForm.channel] ?? effectiveSendForm.channel;
  const billingContext = readReportBillingContext(report.content);
  const warnings = readReportWarnings(report.content);
  const complianceChecks = viewableReportContent
    ? deriveReportComplianceChecks(report.report_type, viewableReportContent)
    : [];
  const complianceReady =
    hasContentView && warnings.length === 0 && complianceChecks.every((item) => item.passed);
  const prescriberInstitutionSuggestion = canUseDeliverySupport
    ? report.prescriber_institution_suggestion
    : null;
  const externalProfessionalSuggestions = canUseDeliverySupport
    ? (report.external_professional_suggestions ??
      externalProfessionalSuggestionsQuery.data?.data ??
      [])
    : [];
  const externalProfessionalSuggestionsError =
    canUseDeliverySupport && externalProfessionalSuggestionsQuery.isError;
  const careTeamSuggestionContacts = externalProfessionalSuggestions.map((suggestion) => ({
    id: suggestion.id,
    role: suggestion.profession_type,
    name: suggestion.name,
    organization_name: suggestion.organization_name,
    phone: suggestion.phone,
  }));
  const deliveryRuleSuggestion = canUseDeliverySupport
    ? (report.delivery_rule_suggestion ?? null)
    : null;
  const reportReadinessItems: VisitReportReadinessItem[] = [
    {
      key: 'content',
      label: '報告書本文',
      description: '訪問記録から生成された本文を確認し、必要に応じて編集します。',
      done: hasContentView,
    },
    {
      key: 'billing',
      label: '算定要件チェック',
      description: '算定要件チェックリストと自動生成警告を確認します。',
      done: complianceReady,
    },
    {
      key: 'recipient',
      label: '送付先候補',
      description: '処方元医療機関、ケアチーム、送達ルールから送付先を選べます。',
      done: Boolean(
        prescriberInstitutionSuggestion ||
        externalProfessionalSuggestions.length > 0 ||
        deliveryRuleSuggestion,
      ),
    },
    {
      key: 'delivery',
      label: '送達履歴',
      description: '送付済み、返信待ち、失敗を確認して他職種連携を閉じます。',
      done: report.delivery_records.length > 0,
      required: false,
    },
  ];

  const deliveryRuleForResolve = deliveryRuleSuggestion
    ? {
        channel: deliveryRuleSuggestion.channel,
        fallback_channels: deliveryRuleSuggestion.fallback_channels,
      }
    : null;
  const directSendDeliveryRuleChannel = deliveryRuleSuggestion
    ? [deliveryRuleSuggestion.channel, ...deliveryRuleSuggestion.fallback_channels].find(
        isCareReportDirectSendChannel,
      )
    : null;
  const expectedRecipientRole = inferCareReportTargetRole(report.report_type);

  function applyInstitutionSuggestion() {
    if (!prescriberInstitutionSuggestion) return;
    setSendForm(
      resolveSuggestionDelivery(
        'institution',
        prescriberInstitutionSuggestion,
        deliveryRuleForResolve,
        'physician',
      ),
    );
  }

  function applyExternalProfessionalSuggestion(suggestion: ExternalProfessionalSuggestion) {
    setSendForm(
      resolveSuggestionDelivery(
        'professional',
        suggestion,
        deliveryRuleForResolve,
        normalizeCareReportRecipientRole(suggestion.profession_type),
      ),
    );
  }

  // p0_28: 共有先候補(処方元医療機関 + ケアチーム/他職種)を送付ターゲットに正規化する。
  // メモ化は React Compiler に委ねる（手動 useMemo は preserve-manual-memoization と競合する）。
  const shareTargets: ShareTarget[] = [
    ...(prescriberInstitutionSuggestion
      ? [
          {
            id: `institution:${prescriberInstitutionSuggestion.id}`,
            label:
              prescriberInstitutionSuggestion.prescriber_name ??
              prescriberInstitutionSuggestion.name,
            audience: '医師',
            ...resolveSuggestionDelivery(
              'institution',
              prescriberInstitutionSuggestion,
              deliveryRuleForResolve,
              'physician',
            ),
          },
        ]
      : []),
    ...externalProfessionalSuggestions.map((suggestion) => ({
      id: `professional:${suggestion.id}`,
      label: suggestion.name,
      audience: PROFESSION_AUDIENCE_LABELS[suggestion.profession_type] ?? '他職種',
      ...resolveSuggestionDelivery(
        'professional',
        suggestion,
        deliveryRuleForResolve,
        normalizeCareReportRecipientRole(suggestion.profession_type),
      ),
    })),
  ].filter(
    (target) =>
      target.recipient_contact.trim().length > 0 &&
      (expectedRecipientRole === 'other' || target.recipient_role === expectedRecipientRole),
  );

  const effectiveSelectedTargetIds = selectedTargetIds;
  const shareTargetIds = shareTargets.map((target) => target.id);
  const selectedShareTargets = shareTargets.filter((target) =>
    effectiveSelectedTargetIds.includes(target.id),
  );
  const allPreSendChecksDone = PRE_SEND_CHECK_ITEMS.every((item) => preSendChecks[item.key]);
  const missingPreSendChecks = PRE_SEND_CHECK_ITEMS.filter((item) => !preSendChecks[item.key]);
  const composerRecipientError =
    composerOpen && shareTargets.length > 0 && selectedShareTargets.length === 0
      ? '共有先を1件以上選択してください'
      : null;
  const composerChecksError =
    composerOpen && missingPreSendChecks.length > 0
      ? `未確認: ${missingPreSendChecks.map((item) => item.label).join('、')}`
      : null;
  const composerSubmitDescriptionIds = [
    composerRecipientError ? 'report-composer-recipient-error' : null,
    composerChecksError ? 'report-composer-checks-error' : null,
  ].filter(Boolean);
  const canBulkSend =
    hasContentView &&
    canSendReportStatus &&
    canUseExternalShare &&
    selectedShareTargets.length > 0 &&
    allPreSendChecksDone &&
    !bulkSendMutation.isPending;
  const shareTargetsLoading =
    externalProfessionalSuggestionsQuery.isLoading ||
    externalProfessionalSuggestionsQuery.isFetching;

  const sendReportAction =
    hasContentView && canSendReportStatus && canSendReport ? (
      <div className="flex flex-wrap gap-2">
        {canUseExternalShare && shareTargets.length > 0 ? (
          <Button
            variant="outline"
            size="sm"
            disabled={shareTargetsLoading}
            onClick={() => {
              // 既定で全候補を選択し、共有先の取りこぼしを防ぐ。
              setSelectedTargetIds(shareTargetIds);
              setPreSendChecks({
                recipient: false,
                content: false,
                consent: false,
                channel: false,
              });
              setComposerOpen(true);
            }}
          >
            <Share2 className="mr-1.5 size-3.5" aria-hidden="true" />
            {shareTargetsLoading ? '共有先を確認中...' : '共有を作成'}
          </Button>
        ) : null}
        <Button
          size="sm"
          onClick={() => {
            if (prescriberInstitutionSuggestion) {
              applyInstitutionSuggestion();
            }
            setSendSafetyAck(false);
            setSendFormErrors({});
            setSendDialogOpen(true);
          }}
        >
          <Send className="mr-1.5 size-3.5" aria-hidden="true" />
          {isRetryableReport ? '再送' : '送付'}
        </Button>
      </div>
    ) : null;

  return (
    <PageScaffold variant="card">
      <div data-testid="report-detail-workspace" className="contents">
        {/* Header */}
        <WorkflowPageIntro
          backHref="/reports"
          backLabel="報告書一覧へ戻る"
          title={REPORT_TYPE_LABELS[report.report_type] ?? report.report_type}
          description={`作成日: ${format(new Date(report.created_at), 'yyyy年M月d日', { locale: ja })}`}
          shortcuts={reportShortcutLinks}
          mainWorkflowSteps={['reports']}
          mainWorkflowDescription="報告書詳細でも、主業務フローの終点として現在地を上部に固定表示します。"
          actions={
            <>
              {statusCfg && <Badge variant={statusCfg.variant}>{statusCfg.label}</Badge>}
              {hasContentView && canEditCurrentDraft && (
                <Button variant="outline" size="sm" onClick={() => setEditMode((v) => !v)}>
                  <Pencil className="mr-1.5 size-3.5" aria-hidden="true" />
                  {isEditingReport ? '表示に戻る' : '編集'}
                </Button>
              )}
              {isConfirmedReport && canOutputReport ? (
                <a
                  href={buildCareReportApiPath(id, '/pdf')}
                  target="_blank"
                  rel="noreferrer"
                  className={cn(
                    buttonVariants({ variant: 'outline', size: 'sm' }),
                    'min-h-[44px] sm:min-h-0',
                  )}
                >
                  <FileText className="mr-1.5 size-3.5" aria-hidden="true" />
                  PDFを開く
                </a>
              ) : null}
              {isConfirmedReport && canOutputReport ? (
                <Link href={buildReportHref(id, '/print')}>
                  <Button variant="outline" size="sm">
                    <Printer className="mr-1.5 size-3.5" aria-hidden="true" />
                    印刷ビュー
                  </Button>
                </Link>
              ) : null}
              {/* p1_05: 他職種向け共有ページ(相手別プレビュー + 返信確認) */}
              {canUseExternalShare ? (
                <Link href={buildReportHref(id, '/share')}>
                  <Button variant="outline" size="sm">
                    <Share2 className="mr-1.5 size-3.5" aria-hidden="true" />
                    他職種共有
                  </Button>
                </Link>
              ) : null}
            </>
          }
        />
        {/* p0: 患者識別を fold 内に固定再掲（取り違え防止）。共通 PatientHeader の識別 tier を再利用。 */}
        <PatientHeader
          name={patientName ?? report.patient_id}
          kana={patientKana}
          birthDate={patientBirthDate}
          archive={
            report.patient_summary?.archive
              ? {
                  archived: report.patient_summary.archive.archived,
                  archivedAt: report.patient_summary.archive.archived_at,
                }
              : null
          }
          sticky={false}
        />
        {/* p0: 報告内容の警告を本文/サイドバー前に要約再掲（モバイルで本文後に埋没させない）。 */}
        {hasContentView && warnings.length > 0 ? (
          <Alert
            data-testid="report-warnings-summary"
            className="border-transparent bg-state-confirm/10 text-state-confirm"
          >
            <AlertTriangle className="size-4 text-state-confirm" aria-hidden="true" />
            <AlertTitle>報告内容に確認事項があります（{warnings.length}件）</AlertTitle>
            <AlertDescription className="text-state-confirm">
              <ul className="list-disc space-y-0.5 pl-4">
                {warnings.map((warning, index) => (
                  <li key={`${index}-${warning}`}>{warning}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        ) : null}
        <VisitReportReadinessPanel
          mode="report_detail"
          items={reportReadinessItems}
          actions={sendReportAction}
        />
        {externalProfessionalSuggestionsError ? (
          <ErrorState
            variant="server"
            size="inline"
            headingLevel={2}
            title="他職種候補を読み込めませんでした"
            description="ケアチーム送付候補の取得に失敗しています。手入力での送付は続行できますが、共有候補を使う場合は再読み込みしてください。"
            action={{
              label: '候補を再読み込み',
              onClick: () => void externalProfessionalSuggestionsQuery.refetch(),
              variant: 'outline',
              size: 'sm',
            }}
            className="items-start text-left"
          />
        ) : null}

        {/* p0_28: 報告書コンポーザー(共有先複数選択 + 報告内容 + 送付前チェック) */}
        {composerOpen && canSendReportStatus && canUseExternalShare ? (
          <Card data-testid="report-composer">
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Share2 className="size-4" aria-hidden="true" />
                {isRetryableReport ? '報告書を再送・共有' : '報告書を作成・共有'}
              </CardTitle>
              <Button variant="ghost" size="sm" onClick={() => setComposerOpen(false)}>
                閉じる
              </Button>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)_18rem]">
                {/* LEFT: 共有先 multi-select */}
                <section aria-label="共有先" className="space-y-2">
                  <h3 className="text-sm font-semibold text-foreground">共有先</h3>
                  {externalProfessionalSuggestionsError ? (
                    <ErrorState
                      variant="server"
                      size="inline"
                      headingLevel={3}
                      title="他職種候補を読み込めませんでした"
                      description="共有先候補の一部または全部を確認できません。再読み込みしてから共有先を選んでください。"
                      action={{
                        label: '候補を再読み込み',
                        onClick: () => void externalProfessionalSuggestionsQuery.refetch(),
                        variant: 'outline',
                        size: 'sm',
                      }}
                      className="px-3 py-4"
                    />
                  ) : null}
                  {shareTargets.length === 0 && !externalProfessionalSuggestionsError ? (
                    <p className="text-sm text-muted-foreground">
                      送付可能な共有先候補がありません。
                    </p>
                  ) : null}
                  {shareTargets.length > 0 ? (
                    <ul className="space-y-2">
                      {shareTargets.map((target) => {
                        const checked = effectiveSelectedTargetIds.includes(target.id);
                        return (
                          <li key={target.id}>
                            <label
                              className={cn(
                                'flex min-h-11 cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2.5 text-sm transition-colors',
                                checked
                                  ? 'border-primary/40 bg-primary/5'
                                  : 'border-border bg-background',
                              )}
                            >
                              <Checkbox
                                checked={checked}
                                onCheckedChange={(value) =>
                                  setSelectedTargetIds((prev) =>
                                    value
                                      ? [...new Set([...prev, target.id])]
                                      : prev.filter((targetId) => targetId !== target.id),
                                  )
                                }
                                className="mt-0.5"
                                aria-label={`${target.audience} ${target.label} を共有先に含める`}
                              />
                              <span className="min-w-0 space-y-0.5">
                                <span className="block font-medium text-foreground">
                                  {target.audience}
                                </span>
                                <span className="block truncate text-xs text-muted-foreground">
                                  {target.label}
                                </span>
                                <span className="block text-xs text-muted-foreground">
                                  {CHANNEL_LABELS[target.channel] ?? target.channel}
                                </span>
                              </span>
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  ) : null}
                  {composerRecipientError ? (
                    <p
                      id="report-composer-recipient-error"
                      role="alert"
                      className="text-xs text-destructive"
                    >
                      {composerRecipientError}
                    </p>
                  ) : null}
                </section>

                {/* CENTER: 報告内容(既存の報告書セクションを再利用) */}
                <section aria-label="報告内容" className="min-w-0 space-y-3">
                  <h3 className="text-sm font-semibold text-foreground">報告内容</h3>
                  {hasContentView ? (
                    <div className="space-y-3">
                      {hasPhysicianContent && (
                        <PhysicianReportView content={report.content as PhysicianReportContent} />
                      )}
                      {hasCareManagerContent && (
                        <CareManagerReportView
                          content={report.content as CareManagerReportContent}
                        />
                      )}
                      {hasAudienceContent && (
                        <AudienceReportView content={report.content as AudienceReportContent} />
                      )}
                    </div>
                  ) : (
                    <Alert>
                      <AlertTriangle className="size-4" aria-hidden="true" />
                      <AlertTitle>共有できる報告内容がありません</AlertTitle>
                      <AlertDescription>
                        現行フォーマットの構造化された報告内容がないため、この画面から共有や送付はできません。訪問記録から報告書を再作成してください。
                      </AlertDescription>
                    </Alert>
                  )}
                </section>

                {/* RIGHT: 送付前チェック(4ガバナンス項目) */}
                <section aria-label="送付前チェック" className="space-y-3">
                  <h3 className="text-sm font-semibold text-foreground">送付前チェック</h3>
                  <ul className="space-y-2">
                    {PRE_SEND_CHECK_ITEMS.map((item) => (
                      <li key={item.key}>
                        <label className="flex min-h-11 cursor-pointer items-start gap-2.5 rounded-md border border-border bg-background px-3 py-2.5 text-sm">
                          <Checkbox
                            checked={preSendChecks[item.key]}
                            onCheckedChange={(value) =>
                              setPreSendChecks((prev) => ({
                                ...prev,
                                [item.key]: Boolean(value),
                              }))
                            }
                            className="mt-0.5"
                            aria-label={item.label}
                          />
                          <span className="space-y-0.5">
                            <span className="block font-medium text-foreground">{item.label}</span>
                            <span className="block text-xs leading-5 text-muted-foreground">
                              {item.description}
                            </span>
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                  {!allPreSendChecksDone ? (
                    <p className="text-xs text-muted-foreground" role="note">
                      4項目すべて確認すると一括送付できます。
                    </p>
                  ) : null}
                  {composerChecksError ? (
                    <p
                      id="report-composer-checks-error"
                      role="alert"
                      className="text-xs text-destructive"
                    >
                      {composerChecksError}
                    </p>
                  ) : null}
                  <Button
                    className="w-full min-h-[44px] sm:min-h-11"
                    onClick={() => handleBulkSend(shareTargets)}
                    disabled={!canBulkSend}
                    aria-describedby={
                      composerSubmitDescriptionIds.length > 0
                        ? composerSubmitDescriptionIds.join(' ')
                        : undefined
                    }
                  >
                    <Send className="mr-1.5 size-3.5" aria-hidden="true" />
                    {bulkSendMutation.isPending
                      ? '送付中...'
                      : `一括送付（${selectedShareTargets.length}件）`}
                  </Button>
                </section>
              </div>
            </CardContent>
          </Card>
        ) : null}

        {/* Main + Sidebar layout */}
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(18rem,0.28fr)] 2xl:grid-cols-[minmax(0,1fr)_22rem]">
          {/* Main content area */}
          <div className="min-w-0 space-y-4 xl:space-y-5">
            {/* Report meta */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <FileText className="size-4" aria-hidden="true" />
                  報告書情報
                </CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="grid grid-cols-2 gap-4 text-sm md:grid-cols-3">
                  <div className="space-y-1">
                    <dt className="text-xs font-medium text-muted-foreground">患者ID</dt>
                    <dd className="font-mono text-xs">{report.patient_id}</dd>
                  </div>
                  <div className="space-y-1">
                    <dt className="text-xs font-medium text-muted-foreground">報告書タイプ</dt>
                    <dd>{REPORT_TYPE_LABELS[report.report_type] ?? report.report_type}</dd>
                  </div>
                  <div className="space-y-1">
                    <dt className="text-xs font-medium text-muted-foreground">ステータス</dt>
                    <dd>
                      {statusCfg ? (
                        <Badge variant={statusCfg.variant}>{statusCfg.label}</Badge>
                      ) : (
                        report.status
                      )}
                    </dd>
                  </div>
                  <div className="space-y-1">
                    <dt className="text-xs font-medium text-muted-foreground">作成日時</dt>
                    <dd className="tabular-nums">
                      {format(new Date(report.created_at), 'yyyy/MM/dd HH:mm', { locale: ja })}
                    </dd>
                  </div>
                  <div className="space-y-1">
                    <dt className="text-xs font-medium text-muted-foreground">更新日時</dt>
                    <dd className="tabular-nums">
                      {format(new Date(report.updated_at), 'yyyy/MM/dd HH:mm', { locale: ja })}
                    </dd>
                  </div>
                </dl>
              </CardContent>
            </Card>

            {billingContext && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">請求コンテキスト</CardTitle>
                </CardHeader>
                <CardContent>
                  <dl className="grid grid-cols-2 gap-4 text-sm md:grid-cols-3">
                    <div className="space-y-1">
                      <dt className="text-xs font-medium text-muted-foreground">保険種別</dt>
                      <dd>
                        {typeof billingContext.payer_basis === 'string'
                          ? billingContext.payer_basis
                          : '—'}
                      </dd>
                    </div>
                    <div className="space-y-1">
                      <dt className="text-xs font-medium text-muted-foreground">適用改定</dt>
                      <dd>
                        {typeof billingContext.effective_revision_code === 'string'
                          ? billingContext.effective_revision_code
                          : '—'}
                      </dd>
                    </div>
                    <div className="space-y-1">
                      <dt className="text-xs font-medium text-muted-foreground">薬局設定</dt>
                      <dd>
                        {typeof billingContext.site_config_status === 'string'
                          ? billingContext.site_config_status
                          : '—'}
                      </dd>
                    </div>
                  </dl>
                </CardContent>
              </Card>
            )}

            {/* p1_04: 下書きは AI 下書きレビュー(5見出し+宛先別プレビュー+薬剤師確認)を先に出す */}
            {report.status === 'draft' && !isEditingReport && canEditReport ? (
              <ReportAiDraftReview
                content={
                  hasPhysicianContent || hasCareManagerContent || hasAudienceContent
                    ? (report.content as
                        | PhysicianReportContent
                        | CareManagerReportContent
                        | AudienceReportContent)
                    : null
                }
                reportType={report.report_type}
                confirmPending={confirmDraftMutation.isPending}
                onConfirm={() => confirmDraftMutation.mutate()}
              />
            ) : null}
            {report.status === 'draft' && !canEditReport ? (
              <Alert className="border-transparent bg-state-confirm/10 text-state-confirm">
                <AlertTriangle className="size-4 text-state-confirm" aria-hidden="true" />
                <AlertTitle>薬剤師確認待ちです</AlertTitle>
                <AlertDescription className="text-state-confirm">
                  この下書きは編集・確認権限を持つ薬剤師または管理者の確認後に送付できます。
                </AlertDescription>
              </Alert>
            ) : null}

            {/* Report content view or edit form */}
            {hasContentView ? (
              <>
                {isEditingReport && editableReportContent ? (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">報告書を編集</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ReportEditForm
                        reportId={id}
                        reportType={report.report_type}
                        updatedAt={report.updated_at}
                        content={editableReportContent}
                        onSaved={() => setEditMode(false)}
                      />
                    </CardContent>
                  </Card>
                ) : (
                  <>
                    {hasPhysicianContent && (
                      <PhysicianReportView content={report.content as PhysicianReportContent} />
                    )}
                    {hasCareManagerContent && (
                      <CareManagerReportView content={report.content as CareManagerReportContent} />
                    )}
                    {hasAudienceContent && (
                      <AudienceReportView content={report.content as AudienceReportContent} />
                    )}
                  </>
                )}
              </>
            ) : isContentHiddenByPermission ? (
              <ErrorState
                variant="forbidden"
                size="inline"
                headingLevel={2}
                title="報告書本文の閲覧権限がありません"
                description="この報告書の本文を閲覧する権限がありません(編集・送付権限が必要です)。編集または送付の権限を持つ薬剤師・管理者にご確認ください。"
              />
            ) : (
              <Alert>
                <AlertTriangle className="size-4" aria-hidden="true" />
                <AlertTitle>構造化された報告内容がありません</AlertTitle>
                <AlertDescription>
                  この報告書は現行フォーマットの必須項目が不足しています。訪問記録から報告書を再作成してください。
                </AlertDescription>
              </Alert>
            )}

            {/* Delivery history */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Clock className="size-4" aria-hidden="true" />
                  送付履歴
                </CardTitle>
              </CardHeader>
              <CardContent>
                {report.delivery_records.length === 0 ? (
                  <p className="text-sm text-muted-foreground">送付履歴がありません</p>
                ) : (
                  <div className="space-y-3">
                    {report.delivery_records.map((rec) => (
                      <div
                        key={rec.id}
                        className="flex items-start justify-between rounded-md border border-border px-4 py-3 text-sm"
                      >
                        <div className="space-y-0.5">
                          <p className="font-medium">{rec.recipient_name}</p>
                          <p className="text-xs text-muted-foreground">
                            {CHANNEL_LABELS[rec.channel] ?? rec.channel}
                            {rec.recipient_contact ? ` — ${rec.recipient_contact}` : ''}
                          </p>
                        </div>
                        <div className="text-right text-xs text-muted-foreground">
                          {rec.sent_at
                            ? format(new Date(rec.sent_at), 'yyyy/MM/dd HH:mm', { locale: ja })
                            : '—'}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Sidebar: compliance checklist (desktop = right column, mobile = below) */}
          {viewableReportContent && (
            <div className="w-full space-y-4">
              <ComplianceChecklist
                reportType={report.report_type}
                content={viewableReportContent}
                warnings={warnings}
              />
              {canUseDeliverySupport && careTeamSuggestionContacts.length > 0 ? (
                <PatientCareTeamSourcePanel contacts={careTeamSuggestionContacts} compact />
              ) : null}
            </div>
          )}
        </div>

        {/* Send dialog */}
        <Dialog
          open={isSendDialogOpen}
          onOpenChange={(open) => {
            setSendDialogOpen(open);
            if (!open) {
              if (requestedSendDialogKey) {
                setDismissedSendDialogKey(requestedSendDialogKey);
              }
              setSendSafetyAck(false);
              setSendFormErrors({});
            }
          }}
        >
          <DialogContent size="2xl">
            <DialogHeader>
              <DialogTitle>{isRetryableReport ? '報告書を再送' : '報告書を送付'}</DialogTitle>
            </DialogHeader>

            <div className="space-y-4 py-2">
              <Alert className="border-transparent bg-state-confirm/10 text-state-confirm">
                <AlertTriangle className="size-4 text-state-confirm" aria-hidden="true" />
                <AlertTitle>送付前確認</AlertTitle>
                <AlertDescription className="text-state-confirm">
                  患者、報告書種別、送付先、チャネルを確認してから送付します。送付操作は送達履歴と連携ログに記録されます。
                </AlertDescription>
              </Alert>

              <dl className="grid gap-2 rounded-lg border border-border/70 bg-muted/20 p-3 text-sm sm:grid-cols-2">
                <div className="space-y-0.5">
                  <dt className="text-xs font-medium text-muted-foreground">患者</dt>
                  <dd className="font-medium text-foreground">
                    {patientName ?? report.patient_id}
                  </dd>
                  {patientName ? (
                    <dd className="font-mono text-xs text-muted-foreground">{report.patient_id}</dd>
                  ) : null}
                </div>
                <div className="space-y-0.5">
                  <dt className="text-xs font-medium text-muted-foreground">カナ</dt>
                  <dd>{patientKana ?? '—'}</dd>
                </div>
                <div className="space-y-0.5">
                  <dt className="text-xs font-medium text-muted-foreground">生年月日</dt>
                  <dd className="tabular-nums">{formatDateLabel(patientBirthDate)}</dd>
                </div>
                <div className="space-y-0.5">
                  <dt className="text-xs font-medium text-muted-foreground">訪問日</dt>
                  <dd className="tabular-nums">{formatDateLabel(visitDate)}</dd>
                </div>
                <div className="space-y-0.5">
                  <dt className="text-xs font-medium text-muted-foreground">報告書</dt>
                  <dd>{REPORT_TYPE_LABELS[report.report_type] ?? report.report_type}</dd>
                </div>
                <div className="space-y-0.5">
                  <dt className="text-xs font-medium text-muted-foreground">送付先</dt>
                  <dd>{recipientNameForConfirmation}</dd>
                </div>
                <div className="space-y-0.5">
                  <dt className="text-xs font-medium text-muted-foreground">連絡先</dt>
                  <dd className="break-all">{recipientContactForConfirmation}</dd>
                </div>
                <div className="space-y-0.5">
                  <dt className="text-xs font-medium text-muted-foreground">チャネル</dt>
                  <dd>{channelLabel}</dd>
                </div>
                <div className="space-y-0.5">
                  <dt className="text-xs font-medium text-muted-foreground">現在の状態</dt>
                  <dd>{statusCfg?.label ?? report.status}</dd>
                </div>
              </dl>

              {externalProfessionalSuggestionsError ? (
                <ErrorState
                  variant="server"
                  size="inline"
                  headingLevel={3}
                  title="他職種候補を読み込めませんでした"
                  description="患者情報ページのケアチーム候補を確認できません。手入力での送付は続行できます。"
                  action={{
                    label: '候補を再読み込み',
                    onClick: () => void externalProfessionalSuggestionsQuery.refetch(),
                    variant: 'outline',
                    size: 'sm',
                  }}
                  className="items-start px-3 py-4 text-left"
                />
              ) : null}

              {prescriberInstitutionSuggestion ? (
                <div className="rounded-lg border-l-4 border-border/70 border-l-tag-info bg-card px-3 py-3 text-sm">
                  <p className="font-medium text-tag-info">
                    処方元医療機関候補: {prescriberInstitutionSuggestion.name}
                  </p>
                  <p className="mt-1 text-xs text-tag-info">
                    最新処方日{' '}
                    {format(
                      new Date(prescriberInstitutionSuggestion.prescribed_date),
                      'yyyy/MM/dd',
                      { locale: ja },
                    )}
                    {prescriberInstitutionSuggestion.fax
                      ? ` / FAX ${prescriberInstitutionSuggestion.fax}`
                      : prescriberInstitutionSuggestion.phone
                        ? ` / TEL ${prescriberInstitutionSuggestion.phone}`
                        : ''}
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-3"
                    onClick={applyInstitutionSuggestion}
                  >
                    候補を適用
                  </Button>
                  {deliveryRuleSuggestion && directSendDeliveryRuleChannel ? (
                    <p className="mt-2 text-xs text-tag-info">
                      送達ルール: {deliveryRuleSuggestion.target_role} 向けは{' '}
                      {CHANNEL_LABELS[directSendDeliveryRuleChannel] ??
                        directSendDeliveryRuleChannel}{' '}
                      を優先
                    </p>
                  ) : null}
                </div>
              ) : null}

              {externalProfessionalSuggestions.length > 0 ? (
                <div className="rounded-lg border-l-4 border-border/70 border-l-tag-info bg-card px-3 py-3 text-sm">
                  <p className="font-medium text-tag-info">患者情報のケアチーム送付候補</p>
                  <p className="mt-1 text-xs text-tag-info">
                    患者情報ページのクリニック・訪問看護・ケアマネジャーを送付先候補として取得しています。
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {externalProfessionalSuggestions.map((suggestion) => (
                      <Button
                        key={suggestion.id}
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => applyExternalProfessionalSuggestion(suggestion)}
                      >
                        {suggestion.name}
                        {suggestion.source === 'patient_care_team' ? '（患者情報）' : ''}
                      </Button>
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-tag-info">
                    他職種マスターに未登録でも、患者情報ページのケアチームに入力されていれば候補に出ます。
                  </p>
                </div>
              ) : null}

              <div className="space-y-1.5">
                <Label htmlFor="send-channel">送付チャネル</Label>
                <Select
                  value={effectiveSendForm.channel}
                  onValueChange={(v) => {
                    setSendDialogOpen(true);
                    setSendForm({ ...effectiveSendForm, channel: v ?? effectiveSendForm.channel });
                  }}
                >
                  <SelectTrigger
                    id="send-channel"
                    aria-label="送付チャネル"
                    className="min-h-[44px] sm:h-8 sm:min-h-0"
                  >
                    <SelectValue>
                      {CHANNEL_LABELS[effectiveSendForm.channel] ?? effectiveSendForm.channel}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {CARE_REPORT_SEND_CHANNELS.map((key) => (
                      <SelectItem key={key} value={key}>
                        {CHANNEL_LABELS[key] ?? key}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="send-recipient-name">
                  送付先氏名{' '}
                  <span className="text-destructive" aria-hidden="true">
                    *
                  </span>
                </Label>
                <Input
                  id="send-recipient-name"
                  value={effectiveSendForm.recipient_name}
                  onChange={(e) => {
                    setSendDialogOpen(true);
                    setSendForm({ ...effectiveSendForm, recipient_name: e.target.value });
                  }}
                  placeholder="例: 山田 太郎 先生"
                  aria-invalid={Boolean(sendFormErrors.recipient_name)}
                  aria-describedby={
                    sendFormErrors.recipient_name ? 'send-recipient-name-error' : undefined
                  }
                  className="min-h-[44px] sm:h-8 sm:min-h-0"
                  required
                />
                {sendFormErrors.recipient_name ? (
                  <p
                    id="send-recipient-name-error"
                    className="text-xs text-destructive"
                    role="alert"
                  >
                    {sendFormErrors.recipient_name}
                  </p>
                ) : null}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="send-recipient-contact">
                  送付先連絡先 <span aria-hidden="true">*</span>
                </Label>
                <Input
                  id="send-recipient-contact"
                  value={effectiveSendForm.recipient_contact}
                  onChange={(e) => {
                    setSendDialogOpen(true);
                    setSendForm({ ...effectiveSendForm, recipient_contact: e.target.value });
                  }}
                  placeholder="メールアドレスまたはFAX番号"
                  aria-invalid={Boolean(sendFormErrors.recipient_contact)}
                  aria-describedby={
                    sendFormErrors.recipient_contact
                      ? 'send-recipient-contact-helper send-recipient-contact-error'
                      : 'send-recipient-contact-helper'
                  }
                  className="min-h-[44px] sm:h-8 sm:min-h-0"
                  required
                />
                <p id="send-recipient-contact-helper" className="text-xs text-muted-foreground">
                  メール送信ではメールアドレス、FAX送信ではFAX番号を入力してください。
                </p>
                {sendFormErrors.recipient_contact ? (
                  <p
                    id="send-recipient-contact-error"
                    className="text-xs text-destructive"
                    role="alert"
                  >
                    {sendFormErrors.recipient_contact}
                  </p>
                ) : null}
              </div>

              <div className="rounded-lg border border-border/70 bg-background px-3 py-3">
                <div className="flex items-start gap-3">
                  <Checkbox
                    id="send-safety-ack"
                    checked={sendSafetyAck}
                    onCheckedChange={(checked) => setSendSafetyAck(Boolean(checked))}
                    aria-invalid={Boolean(sendFormErrors.safety_ack)}
                    aria-describedby={
                      sendFormErrors.safety_ack ? 'send-safety-ack-error' : undefined
                    }
                    className="mt-1"
                  />
                  <div className="space-y-1">
                    <Label
                      htmlFor="send-safety-ack"
                      className="text-sm font-medium text-foreground"
                    >
                      患者、訪問日、報告書種別、送付先氏名、連絡先、送付チャネルを確認しました
                    </Label>
                    <p className="text-xs leading-5 text-muted-foreground">
                      送付後は送達履歴に残り、再送時も連携イベントとして扱われます。
                    </p>
                    {sendFormErrors.safety_ack ? (
                      <p
                        id="send-safety-ack-error"
                        className="text-xs text-destructive"
                        role="alert"
                      >
                        {sendFormErrors.safety_ack}
                      </p>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setSendDialogOpen(false)}
                disabled={sendMutation.isPending}
              >
                キャンセル
              </Button>
              <Button onClick={handleSend} disabled={sendMutation.isPending}>
                <Send className="mr-1.5 size-3.5" aria-hidden="true" />
                {sendMutation.isPending
                  ? isRetryableReport
                    ? '再送中...'
                    : '送付中...'
                  : isRetryableReport
                    ? '再送する'
                    : '送付する'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </PageScaffold>
  );
}
