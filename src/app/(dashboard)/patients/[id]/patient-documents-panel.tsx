'use client';

import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';
import { FileCheck2, FileDown, FilePlus2, FileQuestion, Printer, Save } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loading } from '@/components/ui/loading';
import { Textarea } from '@/components/ui/textarea';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { ManagementPlanPanel } from './management-plan-panel';
import { ExternalShareContent } from './share/external-share-content';
import type { PatientDocumentsSnapshot, PatientOverview } from './patient-detail.types';

type FirstVisitDocumentItem = PatientDocumentsSnapshot['first_visit_documents'][number];
type FirstVisitDocumentStatus = PatientDocumentsSnapshot['document_statuses'][number];
type FirstVisitPrintReadiness = PatientDocumentsSnapshot['print_readiness'];

const DOCUMENT_ACTION_LABELS: Record<string, string> = {
  generated: '作成',
  printed: '印刷',
  recovered: '回収',
  image_saved: '画像保存',
  replaced: '差替え',
  invalidated: '無効化',
};

const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  contract: '契約書',
  important_matters: '重要事項説明書',
  consent: '同意書',
  privacy_consent: '個人情報同意書',
  first_visit_document: '初回訪問文書',
  other: 'その他',
};

const DOCUMENT_STORAGE_LABELS: Record<string, string> = {
  store: '店舗',
  headquarters: '本部',
  patient_home_copy_only: '患者宅控えのみ',
  electronic: '電子保管',
  unknown: '未確認',
};

export function PatientDocumentsPanel({
  patientId,
  patientName,
  cases,
  enabled,
}: {
  patientId: string;
  patientName: string;
  cases: PatientOverview['cases'];
  enabled: boolean;
}) {
  const orgId = useOrgId();
  const documentsQuery = useQuery<PatientDocumentsSnapshot>({
    queryKey: ['patient-documents', patientId, orgId],
    enabled: Boolean(orgId && patientId && enabled),
    queryFn: async () => {
      const response = await fetch(`/api/patients/${patientId}/documents`, {
        headers: { 'x-org-id': orgId ?? '' },
      });
      if (!response.ok) {
        throw new Error('文書情報の取得に失敗しました');
      }
      return response.json();
    },
  });

  if (!orgId) {
    return <Loading label="文書情報を読み込み中..." />;
  }

  if (documentsQuery.isLoading) {
    return <Loading label="文書情報を読み込み中..." />;
  }

  if (documentsQuery.error instanceof Error || !documentsQuery.data) {
    return (
      <Card>
        <CardHeader>
          <h2 className="font-heading text-base leading-snug font-medium">文書</h2>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-destructive">
            {documentsQuery.error instanceof Error
              ? documentsQuery.error.message
              : '文書情報の取得に失敗しました'}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
      <ManagementPlanPanel
        patientId={patientId}
        patientName={patientName}
        cases={cases}
        orgId={orgId}
      />
      <ExternalShareContent patientId={patientId} />
      <div className="xl:col-span-2">
        <FirstVisitDocumentsPanel
          cases={cases}
          documents={documentsQuery.data.first_visit_documents}
          documentStatuses={documentsQuery.data.document_statuses}
          printReadiness={documentsQuery.data.print_readiness}
          orgId={orgId}
          patientId={patientId}
        />
      </div>
    </div>
  );
}

export function FirstVisitDocumentsPanel({
  cases,
  documents,
  documentStatuses = [],
  printReadiness,
  orgId,
  patientId,
}: {
  cases: PatientOverview['cases'];
  documents: FirstVisitDocumentItem[];
  documentStatuses?: FirstVisitDocumentStatus[];
  printReadiness?: FirstVisitPrintReadiness;
  orgId?: string;
  patientId?: string;
}) {
  const printPreviewHref = patientId
    ? `/reports/print?type=first_visit_documents&patient_id=${encodeURIComponent(patientId)}`
    : null;
  const activeCase =
    cases.find((careCase) => careCase.status === 'active') ??
    cases.find((careCase) =>
      ['referral_received', 'assessment', 'on_hold'].includes(careCase.status),
    ) ??
    cases[0] ??
    null;
  const templatesByDocumentType = new Map(
    (printReadiness?.template_versions ?? []).map((template) => [template.document_type, template]),
  );
  const creatableMissingStatuses = documentStatuses.filter((status) => {
    if (status.status !== 'not_created') return false;
    const template = templatesByDocumentType.get(status.document_type);
    return Boolean(template?.template_id);
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="font-heading text-base leading-snug font-medium">
            初回訪問文書・交付記録
          </h2>
          {printPreviewHref ? (
            <Link
              href={printPreviewHref}
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              <Printer className="mr-1.5 size-4" aria-hidden="true" />
              印刷プレビュー
            </Link>
          ) : null}
        </div>
      </CardHeader>
      <CardContent>
        {printReadiness ? <PrintReadinessSummary readiness={printReadiness} /> : null}
        {documentStatuses.length > 0 ? <DocumentStatusSummary statuses={documentStatuses} /> : null}
        {orgId && patientId && activeCase && creatableMissingStatuses.length > 0 ? (
          <MissingFirstVisitDocumentsCreatePanel
            orgId={orgId}
            patientId={patientId}
            caseId={activeCase.id}
            statuses={creatableMissingStatuses}
            templatesByDocumentType={templatesByDocumentType}
          />
        ) : null}
        {documents.length === 0 ? (
          <EmptyState
            icon={FileQuestion}
            title="初回訪問文書はまだありません"
            description="初回訪問の完了後に、緊急連絡先と交付記録を含む文書が自動作成されます。"
          />
        ) : (
          <div className="space-y-4">
            {documents.map((document) => {
              const careCase = cases.find((item) => item.id === document.case_id) ?? null;

              return (
                <div
                  key={document.id}
                  className="rounded-2xl border border-border/70 bg-muted/10 p-4"
                >
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium text-foreground">初回訪問文書</p>
                        <Badge variant="outline">
                          ケース {careCase ? careCase.status : document.case_id}
                        </Badge>
                        {document.delivered_at ? (
                          <Badge>交付記録あり</Badge>
                        ) : (
                          <Badge variant="secondary">交付未記録</Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        作成日時{' '}
                        {format(new Date(document.created_at), 'yyyy/MM/dd HH:mm', { locale: ja })}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        交付先 {document.delivered_to ?? '未記録'} / 交付日時{' '}
                        {document.delivered_at
                          ? format(new Date(document.delivered_at), 'yyyy/MM/dd HH:mm', {
                              locale: ja,
                            })
                          : '未記録'}
                      </p>
                    </div>

                    {document.document_url ? (
                      <Link
                        href={document.document_url}
                        target="_blank"
                        className={buttonVariants({ variant: 'outline', size: 'sm' })}
                      >
                        <FileDown className="mr-1.5 size-4" aria-hidden="true" />
                        控え
                      </Link>
                    ) : null}
                  </div>

                  {orgId && patientId ? (
                    <FirstVisitDocumentStatusForm
                      document={document}
                      orgId={orgId}
                      patientId={patientId}
                    />
                  ) : null}

                  {document.history.length > 0 ? (
                    <div className="mt-4 rounded-lg border border-border/60 bg-background p-3">
                      <p className="text-xs font-medium text-muted-foreground">文書履歴</p>
                      <ol className="mt-2 space-y-2">
                        {document.history.map((history) => (
                          <li key={history.id} className="text-xs text-muted-foreground">
                            <span className="font-medium text-foreground">
                              {DOCUMENT_ACTION_LABELS[history.action] ?? history.action}
                            </span>
                            {' / '}
                            {history.document_type
                              ? (DOCUMENT_TYPE_LABELS[history.document_type] ??
                                history.document_type)
                              : '文書種別未記録'}
                            {' / '}
                            {format(new Date(history.created_at), 'yyyy/MM/dd HH:mm', {
                              locale: ja,
                            })}
                            {history.storage_location ? (
                              <>
                                {' / 保管 '}
                                {DOCUMENT_STORAGE_LABELS[history.storage_location] ??
                                  history.storage_location}
                              </>
                            ) : null}
                            {history.template_name ? (
                              <>
                                {' / '}
                                {history.template_name}
                                {history.template_version ? ` ${history.template_version}` : ''}
                              </>
                            ) : null}
                            {history.reason ? (
                              <span className="block text-amber-800">理由: {history.reason}</span>
                            ) : null}
                            {history.note ? (
                              <span className="block">備考: {history.note}</span>
                            ) : null}
                          </li>
                        ))}
                      </ol>
                    </div>
                  ) : null}

                  <div className="mt-4 space-y-2">
                    <p className="text-xs font-medium text-muted-foreground">緊急連絡先</p>
                    {document.emergency_contacts.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        緊急連絡先は文書作成時点で未登録でした。
                      </p>
                    ) : (
                      <div className="grid gap-2 md:grid-cols-2">
                        {document.emergency_contacts.map((contact) => (
                          <div
                            key={contact.id ?? `${document.id}-${contact.name}`}
                            className="rounded-xl border border-border/60 bg-background p-3"
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="text-sm font-medium text-foreground">{contact.name}</p>
                              <Badge variant="outline">{contact.relation ?? '連絡先'}</Badge>
                              {contact.is_primary ? <Badge variant="secondary">主</Badge> : null}
                            </div>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {contact.organization_name ?? '所属未登録'}
                              {contact.department ? ` / ${contact.department}` : ''}
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {contact.phone ?? contact.email ?? contact.fax ?? '連絡先未登録'}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function MissingFirstVisitDocumentsCreatePanel({
  orgId,
  patientId,
  caseId,
  statuses,
  templatesByDocumentType,
}: {
  orgId: string;
  patientId: string;
  caseId: string;
  statuses: FirstVisitDocumentStatus[];
  templatesByDocumentType: Map<string, FirstVisitPrintReadiness['template_versions'][number]>;
}) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: async () => {
      const results = await Promise.all(
        statuses.map(async (status) => {
          const template = templatesByDocumentType.get(status.document_type);
          const response = await fetch('/api/first-visit-documents', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-org-id': orgId,
            },
            body: JSON.stringify({
              patient_id: patientId,
              case_id: caseId,
              template_id: template?.template_id,
            }),
          });
          if (!response.ok) {
            const errorBody = await response.json().catch(() => ({}));
            throw new Error(errorBody.message ?? `${status.label}の作成に失敗しました`);
          }
          return response.json();
        }),
      );
      return results;
    },
    onSuccess: async () => {
      toast.success('未作成の契約・同意書類を作成しました');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['patient-documents', patientId, orgId] }),
        queryClient.invalidateQueries({ queryKey: ['first-visit-documents', patientId] }),
        queryClient.invalidateQueries({
          queryKey: ['patient-home-operations', patientId, orgId],
        }),
      ]);
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });
  const labels = statuses.map((status) => status.label).join('、');

  return (
    <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50/70 p-3">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm font-semibold text-amber-950">未作成書類を起票できます</p>
          <p className="mt-1 text-xs leading-5 text-amber-900">
            既定テンプレートから {labels} の作成履歴を登録します。
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending}
        >
          <FilePlus2 className="size-4" aria-hidden="true" />
          {mutation.isPending ? '作成中...' : '未作成書類を作成'}
        </Button>
      </div>
    </div>
  );
}

function PrintReadinessSummary({ readiness }: { readiness: FirstVisitPrintReadiness }) {
  const statusLabel =
    readiness.overall_status === 'ready'
      ? '印刷準備OK'
      : readiness.overall_status === 'warning'
        ? '確認あり'
        : '不足あり';
  const statusClass =
    readiness.overall_status === 'ready'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
      : readiness.overall_status === 'warning'
        ? 'border-amber-200 bg-amber-50 text-amber-950'
        : 'border-red-200 bg-red-50 text-red-950';

  return (
    <div
      className="mb-4 rounded-lg border border-border/70 bg-muted/20 p-3"
      data-testid="first-visit-print-readiness"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-foreground">印刷前チェック</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            患者情報・介護保険・連絡先・既定テンプレートを確認します。
          </p>
        </div>
        <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${statusClass}`}>
          {statusLabel}
          {readiness.missing_required_count > 0
            ? ` / 必須不足 ${readiness.missing_required_count}件`
            : readiness.warning_count > 0
              ? ` / 確認 ${readiness.warning_count}件`
              : ''}
        </span>
      </div>
      <div className="mt-3 grid gap-2 md:grid-cols-2">
        {readiness.checks.map((check) => (
          <div key={check.key} className="rounded-lg border border-border/60 bg-card p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={check.completed ? 'default' : 'secondary'}>
                {check.completed ? 'OK' : check.severity === 'required' ? '必須' : '確認'}
              </Badge>
              <p className="text-sm font-medium text-foreground">{check.label}</p>
            </div>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">{check.description}</p>
            {!check.completed ? (
              <Link
                href={check.action_href}
                className={buttonVariants({
                  variant: 'outline',
                  size: 'sm',
                  className: 'mt-2 min-h-8',
                })}
              >
                {check.action_label}
              </Link>
            ) : null}
          </div>
        ))}
      </div>
      <div className="mt-3 rounded-lg border border-border/60 bg-background p-3">
        <p className="text-xs font-medium text-muted-foreground">使用予定テンプレート</p>
        <dl className="mt-2 grid gap-2 text-xs md:grid-cols-2">
          {readiness.template_versions.map((template) => (
            <div key={template.document_type} className="flex justify-between gap-2">
              <dt className="text-muted-foreground">{template.label}</dt>
              <dd className="text-right text-foreground">
                {template.template_name
                  ? `${template.template_name}${template.template_version ? ` ${template.template_version}` : ''}`
                  : '未設定'}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

function DocumentStatusSummary({ statuses }: { statuses: FirstVisitDocumentStatus[] }) {
  return (
    <div
      className="mb-4 rounded-lg border border-border/70 bg-muted/20 p-3"
      data-testid="first-visit-document-status-summary"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">契約・同意書類の現在状態</h3>
        <span className="text-xs text-muted-foreground">
          作成・印刷・回収・画像保存を履歴から復元
        </span>
      </div>
      <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
        {statuses.map((status) => (
          <div
            key={status.document_type}
            className="rounded-lg border border-border/60 bg-card p-3"
          >
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-medium text-foreground">{status.label}</p>
              <Badge variant={status.alerts.length > 0 ? 'secondary' : 'default'}>
                {status.status_label}
              </Badge>
            </div>
            <dl className="mt-2 space-y-1 text-xs text-muted-foreground">
              <div className="flex justify-between gap-2">
                <dt>テンプレート</dt>
                <dd className="text-right text-foreground">
                  {status.template_name
                    ? `${status.template_name}${status.template_version ? ` ${status.template_version}` : ''}`
                    : '未記録'}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt>回収</dt>
                <dd className="text-foreground">
                  {status.delivered_at
                    ? format(new Date(status.delivered_at), 'yyyy/MM/dd', { locale: ja })
                    : '未記録'}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt>画像/PDF</dt>
                <dd className="text-foreground">{status.has_file ? '保存済み' : '未保存'}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt>保管</dt>
                <dd className="text-foreground">
                  {status.storage_location
                    ? (DOCUMENT_STORAGE_LABELS[status.storage_location] ?? status.storage_location)
                    : '未記録'}
                </dd>
              </div>
            </dl>
            {status.alerts.length > 0 ? (
              <ul className="mt-2 space-y-1 text-xs text-amber-800">
                {status.alerts.slice(0, 2).map((alert) => (
                  <li key={alert}>{alert}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function FirstVisitDocumentStatusForm({
  document,
  orgId,
  patientId,
}: {
  document: FirstVisitDocumentItem;
  orgId: string;
  patientId: string;
}) {
  const queryClient = useQueryClient();
  const [deliveredTo, setDeliveredTo] = useState(document.delivered_to ?? '');
  const [documentUrl, setDocumentUrl] = useState(document.document_url ?? '');
  const [documentAction, setDocumentAction] = useState('image_saved');
  const [documentType, setDocumentType] = useState('first_visit_document');
  const [templateName, setTemplateName] = useState('');
  const [templateVersion, setTemplateVersion] = useState('');
  const [storageLocation, setStorageLocation] = useState('store');
  const [historyReason, setHistoryReason] = useState('');
  const [historyNote, setHistoryNote] = useState('');

  const mutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/first-visit-documents/${document.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-org-id': orgId,
        },
        body: JSON.stringify({
          delivered_at: document.delivered_at ?? new Date().toISOString(),
          delivered_to: deliveredTo.trim() || null,
          document_url: documentUrl.trim() || null,
          document_action: {
            action: documentAction,
            document_type: documentType,
            template_name: templateName.trim() || null,
            template_version: templateVersion.trim() || null,
            storage_location: storageLocation,
            reason: historyReason.trim() || null,
            note: historyNote.trim() || null,
          },
        }),
      });
      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        throw new Error(errorBody.message ?? '初回訪問文書の更新に失敗しました');
      }
      return response.json();
    },
    onSuccess: async () => {
      toast.success('初回訪問文書の状態を更新しました');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['patient-documents', patientId, orgId] }),
        queryClient.invalidateQueries({ queryKey: ['first-visit-documents', patientId] }),
        queryClient.invalidateQueries({
          queryKey: ['patient-home-operations', patientId, orgId],
        }),
      ]);
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  return (
    <form
      className="mt-4 rounded-lg border border-border/60 bg-background p-3"
      onSubmit={(event) => {
        event.preventDefault();
        mutation.mutate();
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <FileCheck2 className="size-4 text-muted-foreground" aria-hidden="true" />
        <p className="text-xs font-medium text-muted-foreground">交付・契約画像/PDF保存</p>
      </div>
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`first-visit-delivered-to-${document.id}`}>交付先</Label>
          <Input
            id={`first-visit-delivered-to-${document.id}`}
            value={deliveredTo}
            onChange={(event) => setDeliveredTo(event.target.value)}
            placeholder="本人 / 家族名"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`first-visit-document-url-${document.id}`}>文書URL</Label>
          <Input
            id={`first-visit-document-url-${document.id}`}
            value={documentUrl}
            onChange={(event) => setDocumentUrl(event.target.value)}
            placeholder="/api/visit-records/.../pdf または https://..."
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`first-visit-document-action-${document.id}`}>履歴操作</Label>
          <select
            id={`first-visit-document-action-${document.id}`}
            value={documentAction}
            onChange={(event) => setDocumentAction(event.target.value)}
            className="min-h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
          >
            <option value="generated">作成</option>
            <option value="printed">印刷</option>
            <option value="recovered">回収</option>
            <option value="image_saved">画像保存</option>
            <option value="replaced">差替え</option>
            <option value="invalidated">無効化</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`first-visit-document-type-${document.id}`}>書類種別</Label>
          <select
            id={`first-visit-document-type-${document.id}`}
            value={documentType}
            onChange={(event) => setDocumentType(event.target.value)}
            className="min-h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
          >
            <option value="contract">契約書</option>
            <option value="important_matters">重要事項説明書</option>
            <option value="consent">同意書</option>
            <option value="privacy_consent">個人情報同意書</option>
            <option value="first_visit_document">初回訪問文書</option>
            <option value="other">その他</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`first-visit-template-${document.id}`}>テンプレート</Label>
          <Input
            id={`first-visit-template-${document.id}`}
            value={templateName}
            onChange={(event) => setTemplateName(event.target.value)}
            placeholder="居宅療養管理指導契約書 2026年版"
          />
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_140px] gap-3">
          <div className="space-y-1.5">
            <Label htmlFor={`first-visit-storage-${document.id}`}>原本保管場所</Label>
            <select
              id={`first-visit-storage-${document.id}`}
              value={storageLocation}
              onChange={(event) => setStorageLocation(event.target.value)}
              className="min-h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
            >
              <option value="store">店舗</option>
              <option value="headquarters">本部</option>
              <option value="patient_home_copy_only">患者宅控えのみ</option>
              <option value="electronic">電子保管</option>
              <option value="unknown">未確認</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`first-visit-template-version-${document.id}`}>版</Label>
            <Input
              id={`first-visit-template-version-${document.id}`}
              value={templateVersion}
              onChange={(event) => setTemplateVersion(event.target.value)}
              placeholder="v1.0"
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`first-visit-history-reason-${document.id}`}>理由</Label>
          <Textarea
            id={`first-visit-history-reason-${document.id}`}
            value={historyReason}
            onChange={(event) => setHistoryReason(event.target.value)}
            className="min-h-20"
            placeholder="差替え・無効化理由など"
          />
        </div>
        <div className="space-y-1.5 lg:col-span-2">
          <Label htmlFor={`first-visit-history-note-${document.id}`}>備考</Label>
          <Textarea
            id={`first-visit-history-note-${document.id}`}
            value={historyNote}
            onChange={(event) => setHistoryNote(event.target.value)}
            className="min-h-20"
            placeholder="長女代筆、本人同席あり等"
          />
        </div>
      </div>
      <div className="mt-3 flex justify-end">
        <Button type="submit" size="sm" disabled={mutation.isPending}>
          <Save className="size-4" aria-hidden="true" />
          {mutation.isPending ? '保存中...' : '保存'}
        </Button>
      </div>
    </form>
  );
}
