'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2 } from 'lucide-react';
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

// --- Types ---

type BillingRule = {
  id: string;
  org_id: string;
  rule_type: 'addition' | 'reduction';
  name: string;
  code: string | null;
  conditions: Record<string, unknown>;
  amount: number | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

type RuleFormData = {
  rule_type: 'addition' | 'reduction';
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

async function fetchBillingRules(): Promise<{ data: BillingRule[] }> {
  const res = await fetch('/api/billing-rules');
  if (!res.ok) throw new Error('Failed to fetch billing rules');
  return res.json();
}

async function createBillingRule(body: object): Promise<BillingRule> {
  const res = await fetch('/api/billing-rules', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message ?? 'Failed to create billing rule');
  }
  return res.json();
}

async function updateBillingRule(id: string, body: object): Promise<BillingRule> {
  const res = await fetch(`/api/billing-rules/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message ?? 'Failed to update billing rule');
  }
  return res.json();
}

async function deleteBillingRule(id: string): Promise<void> {
  const res = await fetch(`/api/billing-rules/${id}`, { method: 'DELETE' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message ?? 'Failed to delete billing rule');
  }
}

// --- Form helpers ---

function formDataToPayload(form: RuleFormData) {
  let conditions: Record<string, unknown> = {};
  try {
    conditions = JSON.parse(form.conditions) as Record<string, unknown>;
  } catch {
    // fall through — zod will catch this server-side; show inline error instead
  }

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
  return {
    rule_type: rule.rule_type,
    name: rule.name,
    code: rule.code ?? '',
    conditions: JSON.stringify(rule.conditions, null, 2),
    amount: rule.amount !== null ? String(rule.amount) : '',
    is_active: rule.is_active,
  };
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
      JSON.parse(form.conditions);
      setConditionsError('');
    } catch {
      setConditionsError('JSON形式で入力してください');
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
              <SelectTrigger id="rule-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="addition">加算</SelectItem>
                <SelectItem value="reduction">減算</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Name */}
          <div className="space-y-1">
            <Label htmlFor="rule-name">ルール名</Label>
            <Input
              id="rule-name"
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
              className="font-mono text-xs"
              placeholder='{"visit_count_min": 1}'
            />
            {conditionsError && (
              <p className="text-xs text-destructive">{conditionsError}</p>
            )}
          </div>

          {/* Amount */}
          <div className="space-y-1">
            <Label htmlFor="rule-amount">点数（任意）</Label>
            <Input
              id="rule-amount"
              type="number"
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
              onValueChange={(v) =>
                setForm((f) => ({ ...f, is_active: v === 'true' }))
              }
            >
              <SelectTrigger id="rule-active">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="true">有効</SelectItem>
                <SelectItem value="false">無効</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            キャンセル
          </Button>
          <Button onClick={handleSubmit} disabled={isPending || !form.name.trim()}>
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

  const { data, isLoading } = useQuery({
    queryKey: ['billing-rules'],
    queryFn: fetchBillingRules,
    staleTime: 30_000,
  });

  const createMutation = useMutation({
    mutationFn: createBillingRule,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['billing-rules'] });
      setCreateOpen(false);
      toast.success('算定ルールを作成しました');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: object }) =>
      updateBillingRule(id, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['billing-rules'] });
      setEditTarget(null);
      toast.success('算定ルールを更新しました');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteBillingRule,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['billing-rules'] });
      setDeleteTarget(null);
      toast.success('算定ルールを削除しました');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const columns: ColumnDef<BillingRule>[] = [
    {
      accessorKey: 'name',
      header: 'ルール名',
      cell: ({ row }) => (
        <span className="font-medium text-foreground">{row.original.name}</span>
      ),
    },
    {
      accessorKey: 'rule_type',
      header: '種別',
      cell: ({ row }) =>
        row.original.rule_type === 'addition' ? (
          <Badge variant="default">加算</Badge>
        ) : (
          <Badge variant="outline">減算</Badge>
        ),
    },
    {
      accessorKey: 'code',
      header: '算定コード',
      cell: ({ row }) => row.original.code ?? '-',
    },
    {
      accessorKey: 'amount',
      header: '点数',
      cell: ({ row }) =>
        row.original.amount !== null ? `${row.original.amount}点` : '-',
    },
    {
      accessorKey: 'is_active',
      header: '状態',
      cell: ({ row }) =>
        row.original.is_active ? (
          <Badge variant="secondary" className="text-green-700">有効</Badge>
        ) : (
          <Badge variant="outline" className="text-muted-foreground">無効</Badge>
        ),
    },
    {
      id: 'actions',
      header: '操作',
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            aria-label="編集"
            onClick={() => setEditTarget(row.original)}
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="削除"
            onClick={() => setDeleteTarget(row.original)}
          >
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            算定ルール設定
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            加算・減算の算定ルールを管理します
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          新規追加
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={data?.data ?? []}
        isLoading={isLoading}
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
            updateMutation.mutate({ id: editTarget.id, body: formDataToPayload(form) })
          }
          isPending={updateMutation.isPending}
          title="算定ルールを編集"
        />
      )}

      {/* Delete Confirmation */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(v) => !v && setDeleteTarget(null)}
      >
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
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              削除する
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
