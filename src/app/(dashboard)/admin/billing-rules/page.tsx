'use client';

import { useId, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react';
import { AdminPageHeader } from '@/components/features/admin/admin-page-header';
import { getAdminBillingRulesShortcutLinks } from '@/components/features/admin/admin-page-shortcut-presets';
import { toast } from 'sonner';
import { type ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/ui/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PageScaffold } from '@/components/layout/page-scaffold';
import { parseJsonObjectText } from '@/lib/admin/json-editor';
import { readApiJson } from '@/lib/api/client-json';
import { BILLING_RULES_API_PATH, buildBillingRuleApiPath } from '@/lib/billing-rules/api-paths';
import { messageFromError } from '@/lib/utils/error-message';

// --- Types ---

type BillingRule = {
  id: string;
  org_id: string;
  billing_scope: string;
  rule_type: 'base' | 'addition' | 'regional_addition' | 'reduction';
  service_type: string;
  payer_basis: string | null;
  provider_scope: string | null;
  selection_mode: string;
  calculation_unit: string;
  name: string;
  code: string | null;
  conditions: Record<string, unknown>;
  evidence_requirements: Record<string, unknown>;
  amount: number | null;
  source_url: string | null;
  source_note: string | null;
  is_system: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

type BillingRulesResponse = {
  data: BillingRule[];
  meta: {
    source: {
      source_of_truth: string;
      sync_direction: string | null;
      recovery_procedure: string | null;
    } | null;
    summary: {
      ssot_rule_count: number;
      custom_rule_count: number;
    };
  };
};

type BillingSsotSyncResponse = {
  data: {
    message: string;
    seeded?: number;
  };
};

type RuleFormData = {
  rule_type: 'addition' | 'regional_addition' | 'reduction';
  name: string;
  code: string;
  conditions: string;
  amount: string;
  is_active: boolean;
};

const DEFAULT_FORM: RuleFormData = {
  rule_type: 'addition',
  name: '',
  code: '',
  conditions: '{}',
  amount: '',
  is_active: true,
};

// --- API helpers ---

async function fetchBillingRules(): Promise<BillingRulesResponse> {
  const res = await fetch(BILLING_RULES_API_PATH);
  return readApiJson<BillingRulesResponse>(res, 'Failed to fetch billing rules');
}

async function syncBillingSsot(): Promise<{ message: string }> {
  const res = await fetch(BILLING_RULES_API_PATH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'seed_home_care_ssot' }),
  });
  const payload = await readApiJson<BillingSsotSyncResponse>(res, 'Failed to sync billing SSOT');
  return payload.data;
}

async function createBillingRule(body: object): Promise<BillingRule> {
  const res = await fetch(BILLING_RULES_API_PATH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await readApiJson<{ data: BillingRule }>(res, 'Failed to create billing rule');
  return payload.data;
}

async function updateBillingRule(
  id: string,
  body: object,
  expectedUpdatedAt: string,
): Promise<BillingRule> {
  const res = await fetch(buildBillingRuleApiPath(id), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, expected_updated_at: expectedUpdatedAt }),
  });
  const payload = await readApiJson<{ data: BillingRule }>(res, 'Failed to update billing rule');
  return payload.data;
}

async function deleteBillingRule(rule: BillingRule): Promise<void> {
  const path = `${buildBillingRuleApiPath(rule.id)}?expected_updated_at=${encodeURIComponent(
    rule.updated_at,
  )}`;
  const res = await fetch(path, { method: 'DELETE' });
  await readApiJson<{ data: { id: string } }>(res, 'Failed to delete billing rule');
}

// --- Form helpers ---

function formDataToPayload(form: RuleFormData) {
  const conditions = parseJsonObjectText(form.conditions, 'JSONオブジェクト形式で入力してください');

  return {
    rule_type: form.rule_type,
    name: form.name,
    code: form.code || undefined,
    conditions,
    amount: form.amount !== '' ? parseInt(form.amount, 10) : undefined,
    is_active: form.is_active,
  };
}

function ruleToFormData(rule: BillingRule): RuleFormData {
  const editableRuleType: RuleFormData['rule_type'] =
    rule.rule_type === 'reduction'
      ? 'reduction'
      : rule.rule_type === 'regional_addition'
        ? 'regional_addition'
        : 'addition';

  return {
    rule_type: editableRuleType,
    name: rule.name,
    code: rule.code ?? '',
    conditions: JSON.stringify(rule.conditions, null, 2),
    amount: rule.amount !== null ? String(rule.amount) : '',
    is_active: rule.is_active,
  };
}

function BillingRuleRowActions({
  rule,
  onEdit,
  onDelete,
}: {
  rule: BillingRule;
  onEdit: (rule: BillingRule) => void;
  onDelete: (rule: BillingRule) => void;
}) {
  const systemRuleReasonId = useId();
  const systemRuleReason = rule.is_system ? '公式SSOTルールは編集・削除できません。' : null;

  return (
    <div className="flex flex-col items-start gap-1">
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          className="size-11 sm:size-11"
          aria-label={`${rule.name} を編集`}
          aria-describedby={systemRuleReason ? systemRuleReasonId : undefined}
          disabled={rule.is_system}
          onClick={() => onEdit(rule)}
        >
          <Pencil className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-11 sm:size-11"
          aria-label={`${rule.name} を削除`}
          aria-describedby={systemRuleReason ? systemRuleReasonId : undefined}
          disabled={rule.is_system}
          onClick={() => onDelete(rule)}
        >
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      </div>
      {systemRuleReason ? (
        <p id={systemRuleReasonId} className="max-w-40 text-xs text-muted-foreground">
          {systemRuleReason}
        </p>
      ) : null}
    </div>
  );
}

// --- Rule Form Dialog ---

function RuleFormDialog({
  open,
  onOpenChange,
  initial,
  onSubmit,
  isPending,
  title,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initial: RuleFormData;
  onSubmit: (data: RuleFormData) => void;
  isPending: boolean;
  title: string;
}) {
  const [form, setForm] = useState<RuleFormData>(initial);
  const [conditionsError, setConditionsError] = useState('');

  // Reset form when dialog opens with new initial values
  const handleOpenChange = (v: boolean) => {
    if (v) {
      setForm(initial);
      setConditionsError('');
    }
    onOpenChange(v);
  };

  const handleSubmit = () => {
    try {
      parseJsonObjectText(form.conditions, 'JSONオブジェクト形式で入力してください');
      setConditionsError('');
    } catch (error) {
      setConditionsError(messageFromError(error, 'JSONオブジェクト形式で入力してください'));
      return;
    }
    onSubmit(form);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Rule type */}
          <div className="space-y-1">
            <Label htmlFor="rule-type">種別</Label>
            <Select
              value={form.rule_type}
              onValueChange={(v) =>
                setForm((f) => ({ ...f, rule_type: v as RuleFormData['rule_type'] }))
              }
            >
              <SelectTrigger id="rule-type" className="min-h-11 sm:h-11 sm:min-h-11">
                <SelectValue>
                  {
                    (
                      {
                        addition: '加算',
                        regional_addition: '地域加算',
                        reduction: '減算',
                      } as const
                    )[form.rule_type]
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="addition">加算</SelectItem>
                <SelectItem value="regional_addition">地域加算</SelectItem>
                <SelectItem value="reduction">減算</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Name */}
          <div className="space-y-1">
            <Label htmlFor="rule-name">ルール名</Label>
            <Input
              id="rule-name"
              className="min-h-11 sm:h-11 sm:min-h-11"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="例: 在宅患者重複投薬・相互作用等防止加算"
            />
          </div>

          {/* Code */}
          <div className="space-y-1">
            <Label htmlFor="rule-code">算定コード（任意）</Label>
            <Input
              id="rule-code"
              className="min-h-11 sm:h-11 sm:min-h-11"
              value={form.code}
              onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
              placeholder="例: 01234"
            />
          </div>

          {/* Conditions */}
          <div className="space-y-1">
            <Label htmlFor="rule-conditions">適用条件（JSON）</Label>
            <Textarea
              id="rule-conditions"
              value={form.conditions}
              onChange={(e) => setForm((f) => ({ ...f, conditions: e.target.value }))}
              rows={4}
              className="min-h-24 font-mono text-xs"
              placeholder='{"visit_count_min": 1}'
            />
            {conditionsError && (
              <p role="alert" className="text-xs text-destructive">
                {conditionsError}
              </p>
            )}
          </div>

          {/* Amount */}
          <div className="space-y-1">
            <Label htmlFor="rule-amount">点数（任意）</Label>
            <Input
              id="rule-amount"
              type="number"
              className="min-h-11 sm:h-11 sm:min-h-11"
              value={form.amount}
              onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
              placeholder="例: 40"
            />
          </div>

          {/* Is active */}
          <div className="space-y-1">
            <Label htmlFor="rule-active">有効/無効</Label>
            <Select
              value={form.is_active ? 'true' : 'false'}
              onValueChange={(v) => setForm((f) => ({ ...f, is_active: v === 'true' }))}
            >
              <SelectTrigger id="rule-active" className="min-h-11 sm:h-11 sm:min-h-11">
                <SelectValue>{form.is_active ? '有効' : '無効'}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="true">有効</SelectItem>
                <SelectItem value="false">無効</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            className="min-h-11 sm:h-11 sm:min-h-11"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            キャンセル
          </Button>
          <Button
            className="min-h-11 sm:h-11 sm:min-h-11"
            onClick={handleSubmit}
            disabled={isPending || !form.name.trim()}
          >
            {isPending ? '保存中...' : '保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- Main Page ---

export default function BillingRulesPage() {
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<BillingRule | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<BillingRule | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['billing-rules'],
    queryFn: fetchBillingRules as () => Promise<BillingRulesResponse>,
    staleTime: 30_000,
  });

  const syncMutation = useMutation({
    mutationFn: syncBillingSsot,
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ['billing-rules'] });
      toast.success(result.message);
    },
    onError: (err) => toast.error(messageFromError(err, 'Failed to sync billing SSOT')),
  });

  const createMutation = useMutation({
    mutationFn: createBillingRule,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['billing-rules'] });
      setCreateOpen(false);
      toast.success('算定ルールを作成しました');
    },
    onError: (err) => toast.error(messageFromError(err, 'Failed to create billing rule')),
  });

  const updateMutation = useMutation({
    mutationFn: ({ rule, body }: { rule: BillingRule; body: object }) =>
      updateBillingRule(rule.id, body, rule.updated_at),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['billing-rules'] });
      setEditTarget(null);
      toast.success('算定ルールを更新しました');
    },
    onError: (err) => toast.error(messageFromError(err, 'Failed to update billing rule')),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteBillingRule,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['billing-rules'] });
      setDeleteTarget(null);
      toast.success('算定ルールを削除しました');
    },
    onError: (err) => toast.error(messageFromError(err, 'Failed to delete billing rule')),
  });

  const columns: ColumnDef<BillingRule>[] = [
    {
      accessorKey: 'billing_scope',
      header: 'SSOT',
      cell: ({ row }) =>
        row.original.billing_scope === 'home_care_ssot' ? (
          <Badge variant="secondary" className="gap-1 text-state-done">
            <ShieldCheck className="h-3 w-3" />
            公式
          </Badge>
        ) : (
          <Badge variant="outline">任意</Badge>
        ),
    },
    {
      accessorKey: 'name',
      header: 'ルール名',
      cell: ({ row }) => (
        <div className="space-y-1">
          <span className="font-medium text-foreground">{row.original.name}</span>
          <p className="text-xs text-muted-foreground">
            {row.original.service_type} / {row.original.payer_basis ?? '—'} /{' '}
            {row.original.provider_scope ?? '—'}
          </p>
        </div>
      ),
    },
    {
      id: 'actions',
      header: '操作',
      cell: ({ row }) => (
        <BillingRuleRowActions
          rule={row.original}
          onEdit={setEditTarget}
          onDelete={setDeleteTarget}
        />
      ),
    },
    {
      accessorKey: 'rule_type',
      header: '種別',
      cell: ({ row }) => {
        const labels: Record<BillingRule['rule_type'], string> = {
          base: '基本',
          addition: '加算',
          regional_addition: '地域加算',
          reduction: '減算',
        };
        return <Badge variant="outline">{labels[row.original.rule_type]}</Badge>;
      },
    },
    {
      accessorKey: 'code',
      header: '算定コード',
      cell: ({ row }) => row.original.code ?? '-',
    },
    {
      accessorKey: 'amount',
      header: '算定値',
      cell: ({ row }) =>
        row.original.amount !== null
          ? `${row.original.amount}${row.original.calculation_unit === 'unit' ? '単位' : row.original.calculation_unit === 'percent' ? '%' : '点'}`
          : '-',
    },
    {
      accessorKey: 'is_active',
      header: '状態',
      cell: ({ row }) =>
        row.original.is_active ? (
          <Badge variant="secondary" className="text-state-done">
            有効
          </Badge>
        ) : (
          <Badge variant="outline" className="text-muted-foreground">
            無効
          </Badge>
        ),
    },
  ];

  return (
    <PageScaffold>
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0 flex-1">
          <AdminPageHeader
            title="算定ルール設定"
            description="薬剤師居宅療養管理指導と在宅患者訪問薬剤管理指導の算定 SSOT を管理します。"
            shortcuts={getAdminBillingRulesShortcutLinks()}
            supportingContent={null}
          />
          <div
            aria-label="請求ルールSSOT状態"
            className="-mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground"
          >
            <span className="font-medium text-foreground">公式SSOTと任意ルールを照合</span>
            <Badge variant="secondary">
              公式 {isError ? '—' : (data?.meta.summary.ssot_rule_count ?? 0)}
            </Badge>
            <Badge variant="outline">
              任意 {isError ? '—' : (data?.meta.summary.custom_rule_count ?? 0)}
            </Badge>
            {data?.meta.source ? (
              <span>
                {data.meta.source.source_of_truth} / {data.meta.source.sync_direction ?? 'push'}
              </span>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            className="min-h-11 sm:h-11 sm:min-h-11"
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            {syncMutation.isPending ? '同期中...' : '公式SSOT同期'}
          </Button>
          <Button className="min-h-11 sm:h-11 sm:min-h-11" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            任意ルール追加
          </Button>
        </div>
      </div>

      <DataTable
        columns={columns}
        data={data?.data ?? []}
        isLoading={isLoading}
        errorMessage={
          isError ? '算定ルールの取得に失敗しました。時間をおいて再試行してください。' : undefined
        }
        onRetry={isError ? () => void refetch() : undefined}
        caption="算定ルール一覧"
      />

      {/* Create Dialog */}
      <RuleFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        initial={DEFAULT_FORM}
        onSubmit={(form) => createMutation.mutate(formDataToPayload(form))}
        isPending={createMutation.isPending}
        title="算定ルールを新規追加"
      />

      {/* Edit Dialog */}
      {editTarget && (
        <RuleFormDialog
          open={!!editTarget}
          onOpenChange={(v) => !v && setEditTarget(null)}
          initial={ruleToFormData(editTarget)}
          onSubmit={(form) =>
            updateMutation.mutate({ rule: editTarget, body: formDataToPayload(form) })
          }
          isPending={updateMutation.isPending}
          title="算定ルールを編集"
        />
      )}

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>算定ルールを削除しますか？</AlertDialogTitle>
            <AlertDialogDescription>
              「{deleteTarget?.name}」を削除します。この操作は取り消せません。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>キャンセル</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              削除する
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageScaffold>
  );
}
