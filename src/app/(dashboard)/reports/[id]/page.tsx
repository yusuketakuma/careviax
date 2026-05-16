'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';
import { AlertTriangle, Send, FileText, Clock, Pencil, Printer } from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';
import { getReportDetailShortcutLinks } from '@/components/features/workflow/page-shortcut-presets';
import { WorkflowPageIntro } from '@/components/features/workflow/workflow-page-intro';
import { Button, buttonVariants } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
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
import { useOrgId } from '@/lib/hooks/use-org-id';
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
import type { PhysicianReportContent, CareManagerReportContent } from '@/types/care-report-content';
import { PageScaffold } from '@/components/layout/page-scaffold';
import {
  readReportBillingContext,
  readReportContentObject,
  readReportWarnings,
} from '@/lib/reports/report-content';
import { cn } from '@/lib/utils';

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
  } | null;
  visit_summary?: {
    id: string;
    visit_date: string;
  } | null;
  report_type: string;
  status: string;
  content: PhysicianReportContent | CareManagerReportContent;
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
  delivery_rule_suggestion?: {
    document_type: string;
    target_role: string;
    channel: string;
    fallback_channels: string[];
  } | null;
};

type SendFormData = {
  channel: string;
  recipient_name: string;
  recipient_contact: string;
};

type SendRequestData = SendFormData & {
  safety_ack: true;
};

type SendFormErrors = Partial<Record<keyof SendFormData | 'safety_ack', string>>;

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

function formatDateLabel(value: string | null | undefined) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return format(date, 'yyyy/MM/dd', { locale: ja });
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

// --- Main ---

export default function ReportDetailPage() {
  const { id } = useParams<{ id: string }>();
  const orgId = useOrgId();
  const isBootstrappingOrg = !orgId;
  const queryClient = useQueryClient();

  const [sendDialogOpen, setSendDialogOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [sendForm, setSendForm] = useState<SendFormData>({
    channel: 'email',
    recipient_name: '',
    recipient_contact: '',
  });
  const [sendSafetyAck, setSendSafetyAck] = useState(false);
  const [sendFormErrors, setSendFormErrors] = useState<SendFormErrors>({});

  const { data, isLoading } = useQuery({
    queryKey: ['care-report', id, orgId],
    queryFn: async () => {
      const res = await fetch(`/api/care-reports/${id}`, {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('報告書の取得に失敗しました');
      return res.json() as Promise<{ data: CareReport }>;
    },
    enabled: !!orgId && !!id,
  });

  const report = data?.data;
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
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('他職種候補の取得に失敗しました');
      return res.json() as Promise<{ data: ExternalProfessionalSuggestion[] }>;
    },
    enabled: !!orgId && !!report?.patient_id,
  });

  const sendMutation = useMutation({
    mutationFn: async (formData: SendRequestData) => {
      const res = await fetch(`/api/care-reports/${id}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-org-id': orgId },
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
      setSendDialogOpen(false);
      setSendForm({ channel: 'email', recipient_name: '', recipient_contact: '' });
      setSendSafetyAck(false);
      setSendFormErrors({});
      queryClient.invalidateQueries({ queryKey: ['care-report', id, orgId] });
      queryClient.invalidateQueries({ queryKey: ['care-reports'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function handleSend() {
    const normalizedForm = {
      channel: sendForm.channel,
      recipient_name: sendForm.recipient_name.trim(),
      recipient_contact: sendForm.recipient_contact.trim(),
    };
    const nextErrors: SendFormErrors = {};

    if (!normalizedForm.recipient_name) {
      nextErrors.recipient_name = '送付先氏名は必須です';
    }
    if (!normalizedForm.recipient_contact) {
      nextErrors.recipient_contact = '送付先連絡先は必須です';
    }
    if (
      (normalizedForm.channel === 'email' || normalizedForm.channel === 'ses') &&
      normalizedForm.recipient_contact &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedForm.recipient_contact)
    ) {
      nextErrors.recipient_contact = 'メール送信時はメールアドレスを入力してください';
    }
    if (!sendSafetyAck) {
      nextErrors.safety_ack = '患者、送付先、チャネルを確認してください';
    }

    setSendFormErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      toast.error('送付前の確認項目を見直してください');
      return;
    }
    sendMutation.mutate({ ...normalizedForm, safety_ack: true });
  }

  if (isBootstrappingOrg || isLoading) {
    return (
      <PageScaffold>
        <Loading />
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
  const isPhysician = report.report_type === 'physician_report';
  const isCareManager = report.report_type === 'care_manager_report';
  const hasPhysicianContent = isPhysician && isPhysicianReportContent(report.content);
  const hasCareManagerContent = isCareManager && isCareManagerReportContent(report.content);
  const hasContentView = hasPhysicianContent || hasCareManagerContent;
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
  const recipientNameForConfirmation = sendForm.recipient_name.trim() || '未入力';
  const recipientContactForConfirmation = sendForm.recipient_contact.trim() || '未入力';
  const channelLabel = CHANNEL_LABELS[sendForm.channel] ?? sendForm.channel;
  const genericReportTitle =
    typeof reportContentObject?.title === 'string' ? reportContentObject.title : null;
  const genericReportBody =
    typeof reportContentObject?.body === 'string' ? reportContentObject.body : null;
  const billingContext = readReportBillingContext(report.content);
  const warnings = readReportWarnings(report.content);
  const complianceChecks = hasContentView
    ? deriveReportComplianceChecks(report.report_type, report.content)
    : [];
  const complianceReady =
    hasContentView && warnings.length === 0 && complianceChecks.every((item) => item.passed);
  const prescriberInstitutionSuggestion = report.prescriber_institution_suggestion;
  const externalProfessionalSuggestions = externalProfessionalSuggestionsQuery.data?.data ?? [];
  const careTeamSuggestionContacts = externalProfessionalSuggestions.map((suggestion) => ({
    id: suggestion.id,
    role: suggestion.profession_type,
    name: suggestion.name,
    organization_name: suggestion.organization_name,
    phone: suggestion.phone,
  }));
  const deliveryRuleSuggestion = report.delivery_rule_suggestion ?? null;
  const reportReadinessItems: VisitReportReadinessItem[] = [
    {
      key: 'content',
      label: '報告書本文',
      description: '訪問記録から生成された本文を確認し、必要に応じて編集します。',
      done: hasContentView || Boolean(genericReportBody || genericReportTitle),
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

  function applySuggestion(
    type: 'institution' | 'professional',
    suggestion: {
      name: string;
      phone: string | null;
      fax: string | null;
      email?: string | null;
      recommended_channels: string[];
      prescriber_name?: string | null;
      preferred_contact_method?: string | null;
    },
  ) {
    const suggestedChannels = [
      deliveryRuleSuggestion?.channel,
      ...(deliveryRuleSuggestion?.fallback_channels ?? []),
      ...suggestion.recommended_channels,
    ].filter((value): value is string => Boolean(value));

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
        suggestion.preferred_contact_method ??
        (suggestion.email
          ? 'email'
          : suggestion.fax
            ? 'fax'
            : suggestion.phone
              ? 'phone'
              : 'email');
    }

    const resolvedContact =
      contactByChannel(resolvedChannel) ??
      (type === 'professional'
        ? (suggestion.email ?? suggestion.fax ?? suggestion.phone ?? '')
        : '');

    setSendForm({
      channel: resolvedChannel,
      recipient_name:
        (type === 'institution' ? suggestion.prescriber_name : null) ?? suggestion.name,
      recipient_contact: resolvedContact,
    });
  }

  function applyInstitutionSuggestion() {
    if (!prescriberInstitutionSuggestion) return;
    applySuggestion('institution', prescriberInstitutionSuggestion);
  }

  function applyExternalProfessionalSuggestion(suggestion: ExternalProfessionalSuggestion) {
    applySuggestion('professional', suggestion);
  }

  const sendReportAction = (
    <Button
      size="sm"
      className="min-h-[44px] sm:min-h-0"
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
      送付
    </Button>
  );

  return (
    <PageScaffold>
      <div data-testid="report-detail-workspace" className="contents">
        {/* Header */}
        <WorkflowPageIntro
          backHref="/reports"
          backLabel="報告書一覧へ戻る"
          title={REPORT_TYPE_LABELS[report.report_type] ?? report.report_type}
          description={`作成日: ${format(new Date(report.created_at), 'yyyy年M月d日', { locale: ja })}`}
          shortcuts={getReportDetailShortcutLinks(report.patient_id ?? null, report.id)}
          mainWorkflowSteps={['reports']}
          mainWorkflowDescription="報告書詳細でも、主業務フローの終点として現在地を上部に固定表示します。"
          actions={
            <>
              {statusCfg && <Badge variant={statusCfg.variant}>{statusCfg.label}</Badge>}
              {hasContentView && (
                <Button
                  variant="outline"
                  size="sm"
                  className="min-h-[44px] sm:min-h-0"
                  onClick={() => setEditMode((v) => !v)}
                >
                  <Pencil className="mr-1.5 size-3.5" aria-hidden="true" />
                  {editMode ? '表示に戻る' : '編集'}
                </Button>
              )}
              <a
                href={`/api/care-reports/${id}/pdf`}
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
              <Link href={`/reports/${id}/print`}>
                <Button variant="outline" size="sm" className="min-h-[44px] sm:min-h-0">
                  <Printer className="mr-1.5 size-3.5" aria-hidden="true" />
                  印刷ビュー
                </Button>
              </Link>
            </>
          }
        />
        <VisitReportReadinessPanel
          mode="report_detail"
          items={reportReadinessItems}
          actions={sendReportAction}
        />

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

            {/* Report content view or edit form */}
            {hasContentView ? (
              <>
                {editMode ? (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">報告書を編集</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ReportEditForm
                        reportId={id}
                        reportType={report.report_type}
                        content={report.content}
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
                  </>
                )}
              </>
            ) : reportContentObject ? (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">報告書本文</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {genericReportTitle ? (
                    <p className="text-sm font-semibold text-foreground">{genericReportTitle}</p>
                  ) : null}
                  {genericReportBody ? (
                    <p className="whitespace-pre-wrap text-sm leading-7 text-foreground">
                      {genericReportBody}
                    </p>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      この報告書は旧形式または最小形式の本文です。構造化ビューに必要な項目が不足しているため、保存済み本文のみ表示しています。
                    </p>
                  )}
                </CardContent>
              </Card>
            ) : null}

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
          {hasContentView && (
            <div className="w-full space-y-4">
              <ComplianceChecklist
                reportType={report.report_type}
                content={report.content}
                warnings={warnings}
              />
              {careTeamSuggestionContacts.length > 0 ? (
                <PatientCareTeamSourcePanel contacts={careTeamSuggestionContacts} compact />
              ) : null}
            </div>
          )}
        </div>

        {/* Send dialog */}
        <Dialog
          open={sendDialogOpen}
          onOpenChange={(open) => {
            setSendDialogOpen(open);
            if (!open) {
              setSendSafetyAck(false);
              setSendFormErrors({});
            }
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>報告書を送付</DialogTitle>
            </DialogHeader>

            <div className="space-y-4 py-2">
              <Alert className="border-amber-200 bg-amber-50 text-amber-950">
                <AlertTriangle className="size-4 text-amber-700" aria-hidden="true" />
                <AlertTitle>送付前確認</AlertTitle>
                <AlertDescription className="text-amber-900">
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

              {prescriberInstitutionSuggestion ? (
                <div className="rounded-lg border border-sky-200 bg-sky-50/70 px-3 py-3 text-sm">
                  <p className="font-medium text-sky-900">
                    処方元医療機関候補: {prescriberInstitutionSuggestion.name}
                  </p>
                  <p className="mt-1 text-xs text-sky-800">
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
                    className="mt-3 min-h-[44px] sm:min-h-0"
                    onClick={applyInstitutionSuggestion}
                  >
                    候補を適用
                  </Button>
                  {deliveryRuleSuggestion ? (
                    <p className="mt-2 text-xs text-sky-800">
                      送達ルール: {deliveryRuleSuggestion.target_role} 向けは{' '}
                      {CHANNEL_LABELS[deliveryRuleSuggestion.channel] ??
                        deliveryRuleSuggestion.channel}{' '}
                      を優先
                    </p>
                  ) : null}
                </div>
              ) : null}

              {externalProfessionalSuggestions.length > 0 ? (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 px-3 py-3 text-sm">
                  <p className="font-medium text-emerald-900">患者情報のケアチーム送付候補</p>
                  <p className="mt-1 text-xs text-emerald-800">
                    患者情報ページのクリニック・訪問看護・ケアマネジャーを送付先候補として取得しています。
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {externalProfessionalSuggestions.map((suggestion) => (
                      <Button
                        key={suggestion.id}
                        type="button"
                        variant="outline"
                        size="sm"
                        className="min-h-[44px] sm:min-h-0"
                        onClick={() => applyExternalProfessionalSuggestion(suggestion)}
                      >
                        {suggestion.name}
                        {suggestion.source === 'patient_care_team' ? '（患者情報）' : ''}
                      </Button>
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-emerald-800">
                    他職種マスターに未登録でも、患者情報ページのケアチームに入力されていれば候補に出ます。
                  </p>
                </div>
              ) : null}

              <div className="space-y-1.5">
                <Label htmlFor="send-channel">送付チャネル</Label>
                <Select
                  value={sendForm.channel}
                  onValueChange={(v) =>
                    setSendForm((prev) => ({ ...prev, channel: v ?? prev.channel }))
                  }
                >
                  <SelectTrigger id="send-channel" className="min-h-[44px] sm:h-8 sm:min-h-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(CHANNEL_LABELS).map(([key, label]) => (
                      <SelectItem key={key} value={key}>
                        {label}
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
                  value={sendForm.recipient_name}
                  onChange={(e) =>
                    setSendForm((prev) => ({ ...prev, recipient_name: e.target.value }))
                  }
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
                <Label htmlFor="send-recipient-contact">送付先連絡先</Label>
                <Input
                  id="send-recipient-contact"
                  value={sendForm.recipient_contact}
                  onChange={(e) =>
                    setSendForm((prev) => ({ ...prev, recipient_contact: e.target.value }))
                  }
                  placeholder="メールアドレスまたはFAX番号"
                  aria-invalid={Boolean(sendFormErrors.recipient_contact)}
                  aria-describedby={
                    sendFormErrors.recipient_contact ? 'send-recipient-contact-error' : undefined
                  }
                  className="min-h-[44px] sm:h-8 sm:min-h-0"
                />
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
                className="min-h-[44px] sm:min-h-0"
                onClick={() => setSendDialogOpen(false)}
                disabled={sendMutation.isPending}
              >
                キャンセル
              </Button>
              <Button
                className="min-h-[44px] sm:min-h-0"
                onClick={handleSend}
                disabled={sendMutation.isPending}
              >
                <Send className="mr-1.5 size-3.5" aria-hidden="true" />
                {sendMutation.isPending ? '送付中...' : '送付する'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </PageScaffold>
  );
}
