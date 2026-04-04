'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';
import { Send, FileText, Clock, Pencil, Printer } from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';
import { getReportDetailShortcutLinks } from '@/components/features/workflow/page-shortcut-presets';
import { WorkflowPageIntro } from '@/components/features/workflow/workflow-page-intro';
import { Button, buttonVariants } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { REPORT_TYPE_LABELS, REPORT_STATUS_CONFIG, CHANNEL_LABELS } from '@/lib/constants/status-labels';
import { PhysicianReportView } from '@/components/features/reports/physician-report-view';
import { CareManagerReportView } from '@/components/features/reports/care-manager-report-view';
import { ReportEditForm } from '@/components/features/reports/report-edit-form';
import { ComplianceChecklist } from '@/components/features/reports/compliance-checklist';
import type { PhysicianReportContent, CareManagerReportContent } from '@/types/care-report-content';
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

type ExternalProfessionalSuggestion = {
  id: string;
  name: string;
  profession_type: string;
  organization_name: string | null;
  department: string | null;
  phone: string | null;
  email: string | null;
  fax: string | null;
  preferred_contact_method: string | null;
  preferred_contact_time: string | null;
  last_contacted_at: string | null;
  last_success_channel: string | null;
  recommended_channels: string[];
  is_primary: boolean;
};

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
    queryKey: ['care-report-external-professionals', id, orgId, report?.patient_id, report?.case_id],
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
    mutationFn: async (formData: SendFormData) => {
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
      queryClient.invalidateQueries({ queryKey: ['care-report', id, orgId] });
      queryClient.invalidateQueries({ queryKey: ['care-reports'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function handleSend() {
    if (!sendForm.recipient_name.trim()) {
      toast.error('送付先氏名は必須です');
      return;
    }
    sendMutation.mutate(sendForm);
  }

  if (isBootstrappingOrg || isLoading) {
    return (
      <div className="p-3 md:p-4 xl:p-5">
        <Loading />
      </div>
    );
  }

  if (!report) {
    return (
      <div className="p-3 md:p-4 xl:p-5">
        <p className="text-sm text-muted-foreground">報告書が見つかりません</p>
      </div>
    );
  }

  const statusCfg = REPORT_STATUS_CONFIG[report.status];
  const isPhysician = report.report_type === 'physician_report';
  const isCareManager = report.report_type === 'care_manager_report';
  const hasContentView = isPhysician || isCareManager;

  const warnings =
    (report.content as { warnings?: string[] }).warnings ?? [];
  const prescriberInstitutionSuggestion = report.prescriber_institution_suggestion;
  const externalProfessionalSuggestions = externalProfessionalSuggestionsQuery.data?.data ?? [];
  const deliveryRuleSuggestion = report.delivery_rule_suggestion ?? null;

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
    }
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
        suggestedChannels.find((ch) => ch === 'fax' || ch === 'phone' ? hasContact(ch) : false) ??
        (suggestion.fax ? 'fax' : 'phone');
    } else {
      resolvedChannel =
        suggestedChannels.find(hasContact) ??
        suggestion.preferred_contact_method ??
        (suggestion.email ? 'email' : suggestion.fax ? 'fax' : suggestion.phone ? 'phone' : 'email');
    }

    const resolvedContact =
      contactByChannel(resolvedChannel) ??
      (type === 'professional'
        ? (suggestion.email ?? suggestion.fax ?? suggestion.phone ?? '')
        : '');

    setSendForm({
      channel: resolvedChannel,
      recipient_name: (type === 'institution' ? suggestion.prescriber_name : null) ?? suggestion.name,
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

  return (
    <div className="p-4 md:p-6">
      {/* Header */}
      <WorkflowPageIntro
        backHref="/reports"
        backLabel="報告書一覧へ戻る"
        title={REPORT_TYPE_LABELS[report.report_type] ?? report.report_type}
        description={`作成日: ${format(new Date(report.created_at), 'yyyy年M月d日', { locale: ja })}`}
        shortcuts={getReportDetailShortcutLinks(report.patient_id ?? null, report.id)}
        actions={
          <>
            {statusCfg && <Badge variant={statusCfg.variant}>{statusCfg.label}</Badge>}
            {hasContentView && (
              <Button
                variant="outline"
                size="sm"
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
              className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
            >
              <FileText className="mr-1.5 size-3.5" aria-hidden="true" />
              PDFを開く
            </a>
            <Link href={`/reports/${id}/print`}>
              <Button variant="outline" size="sm">
                <Printer className="mr-1.5 size-3.5" aria-hidden="true" />
                印刷ビュー
              </Button>
            </Link>
            <Button
              size="sm"
              onClick={() => {
                if (prescriberInstitutionSuggestion) {
                  applyInstitutionSuggestion();
                }
                setSendDialogOpen(true);
              }}
            >
              <Send className="mr-1.5 size-3.5" aria-hidden="true" />
              送付
            </Button>
          </>
        }
      />

      {/* Main + Sidebar layout */}
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        {/* Main content area */}
        <div className="min-w-0 flex-1 space-y-6">
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

          {/* Report content view or edit form */}
          {hasContentView && (
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
                  {isPhysician && (
                    <PhysicianReportView
                      content={report.content as PhysicianReportContent}
                    />
                  )}
                  {isCareManager && (
                    <CareManagerReportView
                      content={report.content as CareManagerReportContent}
                    />
                  )}
                </>
              )}
            </>
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
        {hasContentView && (
          <div className="w-full lg:w-72 lg:shrink-0">
            <ComplianceChecklist
              reportType={report.report_type}
              content={report.content}
              warnings={warnings}
            />
          </div>
        )}
      </div>

      {/* Send dialog */}
      <Dialog open={sendDialogOpen} onOpenChange={setSendDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>報告書を送付</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {prescriberInstitutionSuggestion ? (
              <div className="rounded-lg border border-sky-200 bg-sky-50/70 px-3 py-3 text-sm">
                <p className="font-medium text-sky-900">
                  処方元医療機関候補: {prescriberInstitutionSuggestion.name}
                </p>
                <p className="mt-1 text-xs text-sky-800">
                  最新処方日 {format(new Date(prescriberInstitutionSuggestion.prescribed_date), 'yyyy/MM/dd', { locale: ja })}
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
                {deliveryRuleSuggestion ? (
                  <p className="mt-2 text-xs text-sky-800">
                    送達ルール: {deliveryRuleSuggestion.target_role} 向けは {CHANNEL_LABELS[deliveryRuleSuggestion.channel] ?? deliveryRuleSuggestion.channel} を優先
                  </p>
                ) : null}
              </div>
            ) : null}

            {externalProfessionalSuggestions.length > 0 ? (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 px-3 py-3 text-sm">
                <p className="font-medium text-emerald-900">ケアチーム送付候補</p>
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
                    </Button>
                  ))}
                </div>
                <p className="mt-2 text-xs text-emerald-800">
                  他職種マスターの希望チャネルに加えて、送達実績から学習した優先順で送付先を補完します。
                </p>
              </div>
            ) : null}

            <div className="space-y-1.5">
              <Label htmlFor="send-channel">送付チャネル</Label>
              <Select
                value={sendForm.channel}
                onValueChange={(v) => setSendForm((prev) => ({ ...prev, channel: v ?? prev.channel }))}
              >
                <SelectTrigger id="send-channel">
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
                送付先氏名 <span className="text-destructive" aria-hidden="true">*</span>
              </Label>
              <Input
                id="send-recipient-name"
                value={sendForm.recipient_name}
                onChange={(e) =>
                  setSendForm((prev) => ({ ...prev, recipient_name: e.target.value }))
                }
                placeholder="例: 山田 太郎 先生"
                required
              />
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
              />
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
              {sendMutation.isPending ? '送付中...' : '送付する'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
