'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ColumnDef } from '@tanstack/react-table';
import { format, parseISO } from 'date-fns';
import { ja } from 'date-fns/locale';
import { FileText, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { AdminPageHeader } from '@/components/features/admin/admin-page-header';
import { getAdminDocumentTemplatesShortcutLinks } from '@/components/features/admin/admin-page-shortcut-presets';
import { DataTable } from '@/components/ui/data-table';
import { ErrorState } from '@/components/ui/error-state';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { parseJsonObjectText } from '@/lib/admin/json-editor';
import { buildDocumentTemplateApiPath } from '@/lib/document-templates/api-paths';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { DocumentDeliveryRuleManager } from './document-delivery-rule-manager';
import { PageScaffold } from '@/components/layout/page-scaffold';
import { PageSection } from '@/components/layout/page-section';
import { TemplateBodyEditor } from './template-body-editor';

type TemplateType =
  | 'care_report'
  | 'tracing_report'
  | 'management_plan'
  | 'medication_calendar'
  | 'contract_document'
  | 'important_matters'
  | 'privacy_consent'
  | 'consent_form';

type TemplateFormat = 'html' | 'pdf';

type DocumentTemplateRow = {
  id: string;
  name: string;
  template_type: TemplateType;
  target_role: string | null;
  format: TemplateFormat;
  version: number;
  effective_from: string | null;
  effective_to: string | null;
  content: Record<string, unknown>;
  is_default: boolean;
  created_at: string;
  updated_at: string;
};

type DocumentTemplatesResponse = {
  data: DocumentTemplateRow[];
  total_count?: number;
  visible_count?: number;
  hidden_count?: number;
  truncated?: boolean;
  count_basis?: 'templates';
  filters_applied?: {
    template_type?: TemplateType | null;
    target_role?: string | null;
  };
  limit?: number;
};

const TEMPLATE_TYPE_LABELS: Record<TemplateType, string> = {
  care_report: '報告書',
  tracing_report: 'トレーシング',
  management_plan: '計画書',
  medication_calendar: '服薬カレンダー',
  contract_document: '契約書',
  important_matters: '重要事項説明書',
  privacy_consent: '個人情報同意書',
  consent_form: '同意書',
};

const DEFAULT_TEMPLATE_CONTENT: Record<TemplateType, Record<string, unknown>> = {
  care_report: {
    sections: ['summary', 'assessment', 'plan'],
    footer: '訪問記録から自動差込',
  },
  tracing_report: {
    sections: ['issue', 'intervention', 'followup'],
    footer: '服薬情報提供書',
  },
  management_plan: {
    sections: ['goals', 'support_plan', 'review_points'],
  },
  medication_calendar: {
    layout: 'weekly',
    show_dose_icons: true,
  },
  contract_document: {
    sections: ['patient', 'service_start', 'pharmacy', 'fees', 'signature'],
    merge_fields: ['patient.name', 'patient.address', 'case.start_date', 'pharmacy.name'],
    footer: '契約開始日・説明担当者・署名者を確認して保存',
  },
  important_matters: {
    sections: ['provider', 'service_scope', 'fees', 'privacy', 'complaints', 'signature'],
    merge_fields: ['patient.name', 'pharmacy.name', 'pharmacy.phone', 'care_insurance'],
    footer: '最新版の適用期間と説明日を明記',
  },
  privacy_consent: {
    sections: ['purpose', 'shared_parties', 'mcs', 'family', 'signature'],
    merge_fields: ['patient.name', 'key_person.name', 'patient.phone'],
    footer: '利用目的・共有範囲・同意者を明記して保存',
  },
  consent_form: {
    sections: ['purpose', 'scope', 'privacy', 'signature'],
    footer: '説明日と版数を明記して保存',
  },
};

export function DocumentTemplateContent() {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const [filterType, setFilterType] = useState<'all' | TemplateType>('all');
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DocumentTemplateRow | null>(null);
  const [form, setForm] = useState<{
    name: string;
    templateType: TemplateType;
    targetRole: string;
    format: TemplateFormat;
    version: string;
    effectiveFrom: string;
    effectiveTo: string;
    isDefault: boolean;
    contentText: string;
  }>({
    name: '',
    templateType: 'care_report',
    targetRole: '',
    format: 'html',
    version: '1',
    effectiveFrom: '',
    effectiveTo: '',
    isDefault: false,
    contentText: JSON.stringify(DEFAULT_TEMPLATE_CONTENT.care_report, null, 2),
  });

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['document-templates', orgId, filterType],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filterType !== 'all') {
        params.set('template_type', filterType);
      }

      const suffix = params.toString();
      const res = await fetch(`/api/templates${suffix ? `?${suffix}` : ''}`, {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('文書テンプレートの取得に失敗しました');
      return res.json() as Promise<DocumentTemplatesResponse>;
    },
    enabled: !!orgId,
  });

  const visibleTemplateCount = data?.visible_count ?? data?.data.length ?? 0;
  const totalTemplateCount = data?.total_count ?? visibleTemplateCount;
  const hiddenTemplateCount = Math.max(
    data?.hidden_count ?? totalTemplateCount - visibleTemplateCount,
    0,
  );
  const isTemplateListTruncated = Boolean(data?.truncated ?? hiddenTemplateCount > 0);
  const templateListCountLabel = isTemplateListTruncated
    ? `先頭${visibleTemplateCount}件を表示 / 他${hiddenTemplateCount}件`
    : `登録${totalTemplateCount}件`;

  const saveMutation = useMutation({
    mutationFn: async () => {
      const parsedContent = parseJsonObjectText(
        form.contentText,
        'テンプレート本文は JSON オブジェクト形式で入力してください',
      );

      const payload = {
        name: form.name.trim(),
        template_type: form.templateType,
        target_role: form.targetRole.trim() || undefined,
        format: form.format,
        version: Number.parseInt(form.version, 10) || 1,
        effective_from: form.effectiveFrom || undefined,
        effective_to: form.effectiveTo || undefined,
        is_default: form.isDefault,
        content: parsedContent,
      };
      const url = editingTemplateId
        ? buildDocumentTemplateApiPath(editingTemplateId)
        : '/api/templates';
      const method = editingTemplateId ? 'PATCH' : 'POST';

      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'x-org-id': orgId,
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.message ?? 'テンプレートの保存に失敗しました');
      }
      return res.json();
    },
    onSuccess: async () => {
      toast.success(
        editingTemplateId ? 'テンプレートを更新しました' : 'テンプレートを登録しました',
      );
      resetForm();
      await queryClient.invalidateQueries({ queryKey: ['document-templates', orgId] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'テンプレートの保存に失敗しました');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (templateId: string) => {
      const res = await fetch(buildDocumentTemplateApiPath(templateId), {
        method: 'DELETE',
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.message ?? 'テンプレートの削除に失敗しました');
      }
      return res.json();
    },
    onSuccess: async () => {
      toast.success('テンプレートを削除しました');
      resetForm();
      setDeleteTarget(null);
      await queryClient.invalidateQueries({ queryKey: ['document-templates', orgId] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'テンプレートの削除に失敗しました');
    },
  });

  function resetForm() {
    setEditingTemplateId(null);
    setForm({
      name: '',
      templateType: 'care_report',
      targetRole: '',
      format: 'html',
      version: '1',
      effectiveFrom: '',
      effectiveTo: '',
      isDefault: false,
      contentText: JSON.stringify(DEFAULT_TEMPLATE_CONTENT.care_report, null, 2),
    });
  }

  function loadTemplate(template: DocumentTemplateRow) {
    setEditingTemplateId(template.id);
    setForm({
      name: template.name,
      templateType: template.template_type,
      targetRole: template.target_role ?? '',
      format: template.format,
      version: String(template.version),
      effectiveFrom: template.effective_from?.slice(0, 10) ?? '',
      effectiveTo: template.effective_to?.slice(0, 10) ?? '',
      isDefault: template.is_default,
      contentText: JSON.stringify(template.content, null, 2),
    });
  }

  const columns: ColumnDef<DocumentTemplateRow>[] = [
    {
      accessorKey: 'name',
      header: 'テンプレート名',
      cell: ({ row }) => (
        <div>
          <p className="text-sm font-medium">{row.original.name}</p>
          <p className="text-xs text-muted-foreground">
            {TEMPLATE_TYPE_LABELS[row.original.template_type]}
          </p>
        </div>
      ),
    },
    {
      accessorKey: 'is_default',
      header: '既定',
      cell: ({ row }) =>
        row.original.is_default ? <Badge>既定</Badge> : <Badge variant="outline">任意</Badge>,
    },
    {
      accessorKey: 'version',
      header: '版',
      cell: ({ row }) => <span className="text-sm tabular-nums">v{row.original.version}</span>,
    },
    {
      accessorKey: 'updated_at',
      header: '更新日',
      cell: ({ row }) => (
        <span className="text-sm tabular-nums">
          {format(parseISO(row.original.updated_at), 'M/d HH:mm', { locale: ja })}
        </span>
      ),
    },
    {
      id: 'actions',
      header: '操作',
      cell: ({ row }) => (
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            aria-label={`${row.original.name} を編集`}
            onClick={() => loadTemplate(row.original)}
          >
            <Pencil className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            編集
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setDeleteTarget(row.original)}
            disabled={deleteMutation.isPending}
            aria-label={`${row.original.name} を削除`}
          >
            <Trash2 className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            削除
          </Button>
        </div>
      ),
    },
  ];

  return (
    <PageScaffold>
      <AdminPageHeader
        title="文書テンプレート管理"
        description="報告書、契約書、重要事項説明書、同意書のテンプレート版管理と、相手別の自動送達ルールをまとめて管理します。"
        shortcuts={getAdminDocumentTemplatesShortcutLinks()}
      />

      <PageSection
        title="テンプレート版管理"
        description="文書テンプレートの登録・編集と、登録済みテンプレートの版・更新状況を管理します。"
        contentClassName="grid gap-6 xl:grid-cols-[380px_minmax(0,1fr)]"
      >
        <Card>
          <CardHeader>
            <CardTitle asChild className="flex items-center gap-2 text-base">
              <h3>
                <FileText className="h-4 w-4 text-primary" aria-hidden="true" />
                {editingTemplateId ? 'テンプレートを編集' : 'テンプレートを登録'}
              </h3>
            </CardTitle>
            <CardDescription>JSON 形式でブロック構成や固定文言を管理します。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="template-name">テンプレート名</Label>
              <Input
                id="template-name"
                value={form.name}
                onChange={(event) =>
                  setForm((current) => ({ ...current, name: event.target.value }))
                }
                placeholder="主治医報告 基本"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="template-type">種別</Label>
              <Select
                value={form.templateType}
                onValueChange={(value) => {
                  if (!value) return;
                  setForm((current) => ({
                    ...current,
                    templateType: value,
                    contentText:
                      current.name.trim().length === 0 && !editingTemplateId
                        ? JSON.stringify(DEFAULT_TEMPLATE_CONTENT[value], null, 2)
                        : current.contentText,
                  }));
                }}
              >
                <SelectTrigger id="template-type">
                  <SelectValue>{TEMPLATE_TYPE_LABELS[form.templateType]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(TEMPLATE_TYPE_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="template-target-role">対象ロール</Label>
              <Input
                id="template-target-role"
                value={form.targetRole}
                onChange={(event) =>
                  setForm((current) => ({ ...current, targetRole: event.target.value }))
                }
                placeholder="例: physician / care_manager / patient_family"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="template-format">形式</Label>
                <Select
                  value={form.format}
                  onValueChange={(value) =>
                    value && setForm((current) => ({ ...current, format: value as TemplateFormat }))
                  }
                >
                  <SelectTrigger id="template-format">
                    <SelectValue>{form.format === 'pdf' ? 'PDF' : 'HTML'}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="html">HTML</SelectItem>
                    <SelectItem value="pdf">PDF</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="template-version">版</Label>
                <Input
                  id="template-version"
                  type="number"
                  min={1}
                  value={form.version}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, version: event.target.value }))
                  }
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="template-effective-from">有効開始日</Label>
                <Input
                  id="template-effective-from"
                  type="date"
                  value={form.effectiveFrom}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, effectiveFrom: event.target.value }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="template-effective-to">有効終了日</Label>
                <Input
                  id="template-effective-to"
                  type="date"
                  value={form.effectiveTo}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, effectiveTo: event.target.value }))
                  }
                />
              </div>
            </div>

            <div className="flex items-center justify-between rounded-lg border px-3 py-2">
              <div>
                <p className="text-sm font-medium">既定テンプレート</p>
                <p className="text-xs text-muted-foreground">同種別の既定は 1 件だけ保持します</p>
              </div>
              <Switch
                checked={form.isDefault}
                onCheckedChange={(checked) =>
                  setForm((current) => ({ ...current, isDefault: checked }))
                }
                aria-label="既定テンプレートにする"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="template-content">テンプレート本文(JSON)</Label>
              <Textarea
                id="template-content"
                rows={14}
                value={form.contentText}
                onChange={(event) =>
                  setForm((current) => ({ ...current, contentText: event.target.value }))
                }
                className="font-mono text-xs"
              />
            </div>

            <div className="flex gap-2">
              <Button
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending || form.name.trim().length === 0}
              >
                {saveMutation.isPending ? '保存中...' : editingTemplateId ? '更新する' : '登録する'}
              </Button>
              {editingTemplateId ? (
                <Button variant="outline" onClick={resetForm}>
                  キャンセル
                </Button>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle asChild className="text-base">
              <h3>登録済みテンプレート</h3>
            </CardTitle>
            {data ? (
              <Badge variant={isTemplateListTruncated ? 'secondary' : 'outline'}>
                {templateListCountLabel}
              </Badge>
            ) : null}
            <CardDescription>
              主要文書ごとの既定テンプレートと更新状況を確認できます。
            </CardDescription>
            {isTemplateListTruncated ? (
              <p className="text-xs leading-5 text-state-confirm">
                表示上限 {data?.limit ?? visibleTemplateCount} 件に達しています。種別で絞り込むと、
                非表示のテンプレートを確認できます。
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2 pt-2">
              <Button
                size="sm"
                variant={filterType === 'all' ? 'default' : 'outline'}
                onClick={() => setFilterType('all')}
              >
                すべて
              </Button>
              {Object.entries(TEMPLATE_TYPE_LABELS).map(([value, label]) => (
                <Button
                  key={value}
                  size="sm"
                  variant={filterType === value ? 'default' : 'outline'}
                  onClick={() => setFilterType(value as TemplateType)}
                >
                  {label}
                </Button>
              ))}
            </div>
          </CardHeader>
          <CardContent>
            {isError ? (
              // 取得失敗時は空一覧(false-empty)にせず、再読み込み導線つきの ErrorState を出す。
              <ErrorState
                size="inline"
                description="文書テンプレートを取得できませんでした。時間をおいて再読み込みしてください。"
                action={{ label: '再読み込み', onClick: () => void refetch() }}
              />
            ) : (
              <DataTable
                columns={columns}
                data={data?.data ?? []}
                isLoading={isLoading}
                caption="文書テンプレート一覧"
                emptyMessage="文書テンプレートはまだありません"
              />
            )}
          </CardContent>
        </Card>
      </PageSection>

      {/* p1_10: 文面の3カラムエディタ(テンプレート/文面を編集/差し込み項目)。
          自前で section + 見出しを持つ独立ブロックのため PageSection で二重ラップしない。 */}
      <TemplateBodyEditor
        templates={(data?.data ?? []).map((template) => ({
          id: template.id,
          name: template.name,
          content: template.content,
        }))}
      />

      <PageSection
        title="送達ルール"
        description="文書種別と相手ロールごとに、既定の送達チャネルとフォールバック順を管理します。"
      >
        <DocumentDeliveryRuleManager />
      </PageSection>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && !deleteMutation.isPending) {
            setDeleteTarget(null);
          }
        }}
        title="テンプレートを削除しますか"
        description={
          deleteTarget
            ? `${deleteTarget.name}（${TEMPLATE_TYPE_LABELS[deleteTarget.template_type]} v${
                deleteTarget.version
              }）を削除します。この操作は取り消せません。送付や印刷で参照しているテンプレート版を確認してから削除してください。`
            : ''
        }
        confirmLabel={deleteMutation.isPending ? '削除中...' : '削除する'}
        confirmDisabled={deleteMutation.isPending}
        variant="destructive"
        closeOnConfirm={false}
        onConfirm={() => {
          if (deleteTarget) {
            deleteMutation.mutate(deleteTarget.id);
          }
        }}
      />
    </PageScaffold>
  );
}
