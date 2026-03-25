'use client';

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { type ColumnDef } from '@tanstack/react-table';
import { format, parseISO } from 'date-fns';
import { ja } from 'date-fns/locale';
import { Plus, ClipboardCheck } from 'lucide-react';
import { toast } from 'sonner';
import { DataTable } from '@/components/ui/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useOrgId } from '@/lib/hooks/use-org-id';

type SetPlanRow = {
  id: string;
  cycle_id: string;
  target_period_start: string;
  target_period_end: string;
  set_method: string;
  notes: string | null;
  created_at: string;
  cycle: {
    id: string;
    overall_status: string;
    patient_id: string;
    case_: {
      patient: { id: string; name: string; name_kana: string };
    };
  };
  audits: Array<{ id: string; result: string; audited_at: string }>;
};

const SET_METHOD_LABELS: Record<string, string> = {
  facility_calendar: '施設カレンダー',
  four_times_daily: '1日4回',
  bedtime_only: '就寝時のみ',
  custom: 'カスタム',
};

const AUDIT_RESULT_LABELS: Record<string, string> = {
  approved: '承認',
  partial_approved: '部分承認',
  rejected: '差戻し',
};

const AUDIT_RESULT_VARIANTS: Record<
  string,
  'default' | 'secondary' | 'outline' | 'destructive'
> = {
  approved: 'default',
  partial_approved: 'secondary',
  rejected: 'destructive',
};

type CreatePlanForm = {
  cycle_id: string;
  target_period_start: string;
  target_period_end: string;
  set_method: string;
  notes: string;
};

type AuditForm = {
  plan_id: string;
  result: string;
  reject_reason: string;
};

export function MedicationSetsContent() {
  const orgId = useOrgId();
  const queryClient = useQueryClient();

  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showAuditDialog, setShowAuditDialog] = useState(false);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);

  const [createForm, setCreateForm] = useState<CreatePlanForm>({
    cycle_id: '',
    target_period_start: '',
    target_period_end: '',
    set_method: 'facility_calendar',
    notes: '',
  });

  const [auditForm, setAuditForm] = useState<AuditForm>({
    plan_id: '',
    result: 'approved',
    reject_reason: '',
  });

  const { data, isLoading } = useQuery({
    queryKey: ['set-plans', orgId],
    queryFn: async () => {
      const res = await fetch('/api/set-plans', {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('セットプラン一覧の取得に失敗しました');
      return res.json() as Promise<{ data: SetPlanRow[] }>;
    },
    enabled: !!orgId,
  });

  const createMutation = useMutation({
    mutationFn: async (form: CreatePlanForm) => {
      const res = await fetch('/api/set-plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-org-id': orgId },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message ?? 'セットプランの作成に失敗しました');
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success('セットプランを作成しました');
      setShowCreateDialog(false);
      void queryClient.invalidateQueries({ queryKey: ['set-plans', orgId] });
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  const auditMutation = useMutation({
    mutationFn: async (form: AuditForm) => {
      const res = await fetch('/api/set-audits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-org-id': orgId },
        body: JSON.stringify({
          plan_id: form.plan_id,
          result: form.result,
          reject_reason: form.reject_reason || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message ?? 'セット鑑査の実行に失敗しました');
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success('セット鑑査を完了しました');
      setShowAuditDialog(false);
      void queryClient.invalidateQueries({ queryKey: ['set-plans', orgId] });
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  const columns = useMemo<ColumnDef<SetPlanRow>[]>(
    () => [
      {
        id: 'patient_name',
        header: '患者名',
        cell: ({ row }) => {
          const p = row.original.cycle.case_.patient;
          return (
            <div>
              <div className="font-medium">{p.name}</div>
              <div className="text-xs text-muted-foreground">{p.name_kana}</div>
            </div>
          );
        },
      },
      {
        accessorKey: 'set_method',
        header: 'セット方式',
        cell: ({ row }) => (
          <span className="text-sm">
            {SET_METHOD_LABELS[row.original.set_method] ??
              row.original.set_method}
          </span>
        ),
      },
      {
        id: 'period',
        header: '対象期間',
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-sm">
            {format(parseISO(row.original.target_period_start), 'M/d', {
              locale: ja,
            })}
            {' — '}
            {format(parseISO(row.original.target_period_end), 'M/d', {
              locale: ja,
            })}
          </span>
        ),
      },
      {
        id: 'audit_status',
        header: '鑑査状態',
        cell: ({ row }) => {
          const latestAudit = row.original.audits[0];
          if (!latestAudit)
            return (
              <Badge variant="outline">未鑑査</Badge>
            );
          return (
            <Badge
              variant={
                AUDIT_RESULT_VARIANTS[latestAudit.result] ?? 'outline'
              }
            >
              {AUDIT_RESULT_LABELS[latestAudit.result] ?? latestAudit.result}
            </Badge>
          );
        },
      },
      {
        accessorKey: 'created_at',
        header: '作成日',
        cell: ({ row }) =>
          format(parseISO(row.original.created_at), 'M/d', { locale: ja }),
      },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) => {
          const hasAudit = row.original.audits.length > 0;
          return (
            <Button
              size="sm"
              variant="outline"
              disabled={hasAudit}
              onClick={() => {
                setSelectedPlanId(row.original.id);
                setAuditForm({
                  plan_id: row.original.id,
                  result: 'approved',
                  reject_reason: '',
                });
                setShowAuditDialog(true);
              }}
            >
              <ClipboardCheck className="mr-1 size-3" aria-hidden="true" />
              セット鑑査
            </Button>
          );
        },
      },
    ],
    []
  );

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button
          onClick={() => {
            setCreateForm({
              cycle_id: '',
              target_period_start: '',
              target_period_end: '',
              set_method: 'facility_calendar',
              notes: '',
            });
            setShowCreateDialog(true);
          }}
        >
          <Plus className="mr-2 size-4" aria-hidden="true" />
          セットプラン作成
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={data?.data ?? []}
        isLoading={isLoading}
        caption="セット管理一覧"
      />

      {/* Create plan dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>セットプラン作成</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label htmlFor="cycle_id">サイクルID</Label>
              <Input
                id="cycle_id"
                value={createForm.cycle_id}
                onChange={(e) =>
                  setCreateForm((f) => ({ ...f, cycle_id: e.target.value }))
                }
                placeholder="cycle_id を入力"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="period_start">対象期間開始</Label>
                <Input
                  id="period_start"
                  type="date"
                  value={createForm.target_period_start}
                  onChange={(e) =>
                    setCreateForm((f) => ({
                      ...f,
                      target_period_start: e.target.value,
                    }))
                  }
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="period_end">対象期間終了</Label>
                <Input
                  id="period_end"
                  type="date"
                  value={createForm.target_period_end}
                  onChange={(e) =>
                    setCreateForm((f) => ({
                      ...f,
                      target_period_end: e.target.value,
                    }))
                  }
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="set_method">セット方式</Label>
              <Select
                value={createForm.set_method}
                onValueChange={(v) =>
                  v && setCreateForm((f) => ({ ...f, set_method: v }))
                }
              >
                <SelectTrigger id="set_method">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(SET_METHOD_LABELS).map(([k, label]) => (
                    <SelectItem key={k} value={k}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="notes">注意事項</Label>
              <Textarea
                id="notes"
                value={createForm.notes}
                onChange={(e) =>
                  setCreateForm((f) => ({ ...f, notes: e.target.value }))
                }
                rows={3}
                placeholder="セット時の注意事項を入力"
              />
            </div>
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline">キャンセル</Button>} />
            <Button
              onClick={() => createMutation.mutate(createForm)}
              disabled={
                createMutation.isPending ||
                !createForm.cycle_id ||
                !createForm.target_period_start ||
                !createForm.target_period_end
              }
            >
              {createMutation.isPending ? '作成中...' : '作成'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Audit dialog */}
      <Dialog open={showAuditDialog} onOpenChange={setShowAuditDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>セット鑑査</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label htmlFor="audit_result">鑑査結果</Label>
              <Select
                value={auditForm.result}
                onValueChange={(v) =>
                  v && setAuditForm((f) => ({ ...f, result: v }))
                }
              >
                <SelectTrigger id="audit_result">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="approved">承認</SelectItem>
                  <SelectItem value="partial_approved">部分承認</SelectItem>
                  <SelectItem value="rejected">差戻し</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {(auditForm.result === 'rejected' ||
              auditForm.result === 'partial_approved') && (
              <div className="space-y-1">
                <Label htmlFor="reject_reason">差戻し理由</Label>
                <Textarea
                  id="reject_reason"
                  value={auditForm.reject_reason}
                  onChange={(e) =>
                    setAuditForm((f) => ({
                      ...f,
                      reject_reason: e.target.value,
                    }))
                  }
                  rows={3}
                  placeholder="差戻しまたは部分承認の理由を入力"
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline">キャンセル</Button>} />
            <Button
              onClick={() => auditMutation.mutate(auditForm)}
              disabled={auditMutation.isPending}
            >
              {auditMutation.isPending ? '処理中...' : '鑑査実行'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
