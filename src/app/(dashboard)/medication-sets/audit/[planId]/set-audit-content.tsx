'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Info,
  Loader2,
  CalendarDays,
  Package,
} from 'lucide-react';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { useRealtimeQuery } from '@/lib/hooks/use-realtime-query';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { buildSetAuditSubmission } from './set-audit-content.helpers';

// ── Types ──

type SetBatch = {
  id: string;
  plan_id: string;
  line_id: string;
  slot: string;
  day_number: number;
  quantity: number;
  carry_type: string;
  version: number;
  line: {
    id: string;
    drug_name: string;
    dose: string;
    frequency: string;
    unit: string | null;
  };
};

type RejectReasonCode =
  | 'drug_mismatch'
  | 'quantity_error'
  | 'patient_change'
  | 'prescription_expired'
  | 'other';

// ── Constants ──

const SLOT_LABELS: Record<string, string> = {
  morning: '朝食後',
  noon: '昼食後',
  evening: '夕食後',
  bedtime: '眠前',
  prn: '頓用',
};

const SLOT_ORDER = ['morning', 'noon', 'evening', 'bedtime', 'prn'];

const CARRY_TYPE_LABELS: Record<string, string> = {
  carry: '持参',
  facility_deposit: '施設預け',
  deferred: '後日対応',
};

const REJECT_REASON_OPTIONS: { value: RejectReasonCode; label: string }[] = [
  { value: 'drug_mismatch', label: '薬剤不一致' },
  { value: 'quantity_error', label: '数量誤り' },
  { value: 'patient_change', label: '患者状態変化' },
  { value: 'prescription_expired', label: '処方期限切れ' },
  { value: 'other', label: 'その他' },
];

// ── Helpers ──

/**
 * Group batches by day_number, then by slot within each day.
 * Returns a sorted structure: days ascending, slots in SLOT_ORDER.
 */
type DayGroup = {
  dayNumber: number;
  slots: SlotGroup[];
};

type SlotGroup = {
  slot: string;
  slotLabel: string;
  batches: SetBatch[];
};

function groupBatchesByDayAndSlot(batches: SetBatch[]): DayGroup[] {
  const dayMap = new Map<number, Map<string, SetBatch[]>>();

  for (const batch of batches) {
    if (!dayMap.has(batch.day_number)) {
      dayMap.set(batch.day_number, new Map());
    }
    const slotMap = dayMap.get(batch.day_number)!;
    if (!slotMap.has(batch.slot)) {
      slotMap.set(batch.slot, []);
    }
    slotMap.get(batch.slot)!.push(batch);
  }

  const days = Array.from(dayMap.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([dayNumber, slotMap]) => {
      const slots = Array.from(slotMap.entries())
        .sort((a, b) => {
          const ai = SLOT_ORDER.indexOf(a[0]);
          const bi = SLOT_ORDER.indexOf(b[0]);
          return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
        })
        .map(([slot, slotBatches]) => ({
          slot,
          slotLabel: SLOT_LABELS[slot] ?? slot,
          batches: slotBatches,
        }));
      return { dayNumber, slots };
    });

  return days;
}

// ── Sub-components ──

function SlotGroupCard({
  slotGroup,
  approvalState,
}: {
  slotGroup: SlotGroup;
  approvalState: boolean | null;
}) {
  return (
    <div className="rounded-md border bg-card">
      <div className="flex items-center gap-2 border-b bg-muted/20 px-3 py-2">
        <Package className="size-3.5 text-muted-foreground" aria-hidden="true" />
        <span className="text-xs font-semibold">{slotGroup.slotLabel}</span>
        <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-100 text-xs ml-1">
          一包化
        </Badge>
        <span className="ml-auto">
          {approvalState === true && (
            <span className="flex items-center gap-1 text-xs text-green-700">
              <CheckCircle2 className="size-3.5" aria-hidden="true" /> 承認済
            </span>
          )}
          {approvalState === false && (
            <span className="flex items-center gap-1 text-xs text-red-700">
              <XCircle className="size-3.5" aria-hidden="true" /> 差戻し
            </span>
          )}
          {approvalState === null && (
            <span className="text-xs text-muted-foreground">未鑑査</span>
          )}
        </span>
      </div>
      <ul className="divide-y">
        {slotGroup.batches.map((batch) => (
          <li key={batch.id} className="flex items-baseline justify-between px-3 py-2">
            <div className="space-y-0.5">
              <p className="text-sm font-medium leading-snug">{batch.line.drug_name}</p>
              <p className="text-xs text-muted-foreground">
                {batch.line.dose} / {batch.line.frequency}
              </p>
              {batch.carry_type !== 'carry' && (
                <p className="text-xs text-muted-foreground">
                  持参区分: {CARRY_TYPE_LABELS[batch.carry_type] ?? batch.carry_type}
                </p>
              )}
            </div>
            <span className="ml-4 shrink-0 tabular-nums text-sm font-semibold">
              {batch.quantity}
              {batch.line.unit ?? ''}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DayCard({
  day,
  localApproval,
  onApproveDay,
  onRejectDay,
  isPending,
}: {
  day: DayGroup;
  localApproval: Map<string, boolean | null>;
  onApproveDay: (dayNumber: number) => void;
  onRejectDay: (dayNumber: number) => void;
  isPending: boolean;
}) {
  const slotKeys = day.slots.map((s) => `${day.dayNumber}-${s.slot}`);
  const anyPending = slotKeys.some((k) => {
    const state = localApproval.get(k);
    return state === undefined || state === null;
  });
  const allApproved = slotKeys.every((k) => localApproval.get(k) === true);
  const anyRejected = slotKeys.some((k) => localApproval.get(k) === false);

  return (
    <Card>
      <CardHeader className="border-b py-3 px-4">
        <div className="flex items-center gap-3">
          <CalendarDays className="size-4 text-muted-foreground" aria-hidden="true" />
          <CardTitle className="text-sm font-semibold">Day {day.dayNumber}</CardTitle>
          {allApproved && !anyRejected && (
            <Badge className="bg-green-100 text-green-800 hover:bg-green-100 text-xs">
              承認済
            </Badge>
          )}
          {anyRejected && (
            <Badge className="bg-red-100 text-red-800 hover:bg-red-100 text-xs">
              差戻しあり
            </Badge>
          )}
          {anyPending && !allApproved && (
            <Badge variant="outline" className="text-xs">
              未鑑査
            </Badge>
          )}
          <div className="ml-auto flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="h-7 border-green-600 text-green-700 hover:bg-green-50 text-xs"
              onClick={() => onApproveDay(day.dayNumber)}
              disabled={isPending || allApproved}
              aria-label={`Day ${day.dayNumber}を承認`}
            >
              <CheckCircle2 className="mr-1 size-3.5" aria-hidden="true" />
              承認
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 border-red-500 text-red-600 hover:bg-red-50 text-xs"
              onClick={() => onRejectDay(day.dayNumber)}
              disabled={isPending}
              aria-label={`Day ${day.dayNumber}を差戻し`}
            >
              <XCircle className="mr-1 size-3.5" aria-hidden="true" />
              差戻し
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 p-4">
        {day.slots.map((slotGroup) => {
          const key = `${day.dayNumber}-${slotGroup.slot}`;
          const state = localApproval.has(key) ? (localApproval.get(key) ?? null) : null;
          return (
            <SlotGroupCard
              key={key}
              slotGroup={slotGroup}
              approvalState={state}
            />
          );
        })}
      </CardContent>
    </Card>
  );
}

// ── Main ──

export function SetAuditContent({ planId }: { planId: string }) {
  const queryClient = useQueryClient();
  const orgId = useOrgId();

  // local slot-level approval state: key = `${dayNumber}-${slot}`
  const [localApproval, setLocalApproval] = useState<Map<string, boolean | null>>(new Map());
  const [rejectReasonsByDay, setRejectReasonsByDay] = useState<Map<number, string>>(new Map());
  const [isAuditSaved, setIsAuditSaved] = useState(false);

  // reject dialog state
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [pendingRejectDayNumber, setPendingRejectDayNumber] = useState<number | null>(null);
  const [rejectReasonCode, setRejectReasonCode] = useState<RejectReasonCode | ''>('');
  const [rejectNote, setRejectNote] = useState('');

  const { data, isLoading, isError } = useRealtimeQuery({
    queryKey: ['set-batches', planId],
    queryFn: async () => {
      const res = await fetch(`/api/set-batches?plan_id=${planId}`, {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('セットバッチの取得に失敗しました');
      const json = (await res.json()) as { data: SetBatch[] };
      return json.data;
    },
    enabled: Boolean(planId && orgId),
    invalidateOn: ['cycle_transition', 'workflow_refresh'],
  });

  const auditMutation = useMutation({
    mutationFn: async (payload: {
      plan_id: string;
      result: 'approved' | 'partial_approved' | 'rejected';
      approved_scope?: Record<string, unknown>;
      reject_reason?: string;
    }) => {
      const res = await fetch('/api/set-audits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-org-id': orgId },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(err.message ?? '鑑査の保存に失敗しました');
      }
      return res.json();
    },
    onSuccess: () => {
      setIsAuditSaved(true);
      queryClient.invalidateQueries({ queryKey: ['set-batches', planId] });
    },
  });

  const rawBatches = data ?? [];
  const days = groupBatchesByDayAndSlot(rawBatches);

  // Summary counts at slot level
  const allSlotKeys = days.flatMap((day) =>
    day.slots.map((s) => `${day.dayNumber}-${s.slot}`)
  );
  const approvedCount = allSlotKeys.filter((k) => localApproval.get(k) === true).length;
  const rejectedCount = allSlotKeys.filter((k) => localApproval.get(k) === false).length;
  const pendingCount = allSlotKeys.length - approvedCount - rejectedCount;

  // Approve all slots in a day
  function handleApproveDay(dayNumber: number) {
    const day = days.find((d) => d.dayNumber === dayNumber);
    if (!day) return;

    const keys = day.slots.map((s) => `${dayNumber}-${s.slot}`);
    setLocalApproval((prev) => {
      const next = new Map(prev);
      for (const k of keys) next.set(k, true);
      return next;
    });
    setRejectReasonsByDay((prev) => {
      const next = new Map(prev);
      next.delete(dayNumber);
      return next;
    });
    toast.success(`Day ${dayNumber} を承認候補としてマークしました`);
  }

  // Open reject dialog for a day
  function handleRejectDayOpen(dayNumber: number) {
    setPendingRejectDayNumber(dayNumber);
    setRejectDialogOpen(true);
  }

  // Confirm reject for a day
  function handleRejectConfirm() {
    if (!rejectReasonCode || pendingRejectDayNumber === null) {
      toast.error('差戻し理由を選択してください');
      return;
    }

    const day = days.find((d) => d.dayNumber === pendingRejectDayNumber);
    if (!day) return;

    const keys = day.slots.map((s) => `${pendingRejectDayNumber}-${s.slot}`);
    setLocalApproval((prev) => {
      const next = new Map(prev);
      for (const k of keys) next.set(k, false);
      return next;
    });

    const rejectLabel =
      REJECT_REASON_OPTIONS.find((o) => o.value === rejectReasonCode)?.label ??
      rejectReasonCode;
    const rejectText = rejectNote ? `${rejectLabel}: ${rejectNote}` : rejectLabel;
    setRejectReasonsByDay((prev) => {
      const next = new Map(prev);
      next.set(pendingRejectDayNumber, rejectText);
      return next;
    });
    toast.success(`Day ${pendingRejectDayNumber} を差戻し候補としてマークしました`);

    setRejectDialogOpen(false);
    setPendingRejectDayNumber(null);
    setRejectReasonCode('');
    setRejectNote('');
  }

  // Approve all pending days
  function handleApproveAll() {
    if (allSlotKeys.length === 0) {
      toast.warning('セットバッチがありません');
      return;
    }

    const allKeys = allSlotKeys;
    setLocalApproval((prev) => {
      const next = new Map(prev);
      for (const k of allKeys) next.set(k, true);
      return next;
    });
    setRejectReasonsByDay(new Map());
    toast.success('全スロットを承認候補としてマークしました。保存して確定してください。');
  }

  function handleSubmitAudit() {
    const submission = buildSetAuditSubmission({
      allSlotKeys,
      localApproval,
      rejectReasonsByDay,
    });

    if (submission.kind === 'empty') {
      toast.warning(submission.message);
      return;
    }
    if (submission.kind === 'pending') {
      toast.error(submission.message);
      return;
    }

    auditMutation.mutate(
      { plan_id: planId, ...submission.payload },
      {
        onSuccess: () => {
          const label =
            submission.payload.result === 'approved'
              ? '全承認'
              : submission.payload.result === 'partial_approved'
                ? '部分承認'
                : '差戻し';
          toast.success(`セット鑑査を${label}で保存しました`);
        },
        onError: (err) => toast.error(err.message),
      }
    );
  }

  if (!orgId || isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden="true" />
        <span className="ml-2 text-sm text-muted-foreground">読み込み中...</span>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
        セットバッチの取得に失敗しました。ページを再読み込みしてください。
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Plan info banner */}
      <div className="flex items-start gap-3 rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <div>
          <p className="font-medium">セットプラン ID: {planId}</p>
          <p className="mt-0.5 text-blue-700">
            {rawBatches.length > 0
              ? `${days.length}日分 / ${rawBatches.length}件のバッチが登録されています`
              : 'バッチが登録されていません'}
          </p>
        </div>
      </div>

      {/* Summary badges */}
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-muted-foreground">未鑑査:</span>
        <Badge variant="outline">{pendingCount}スロット</Badge>
        <span className="text-sm text-muted-foreground">承認:</span>
        <Badge className="bg-green-100 text-green-800 hover:bg-green-100">
          {approvedCount}スロット
        </Badge>
        <span className="text-sm text-muted-foreground">差戻し:</span>
        <Badge className="bg-red-100 text-red-800 hover:bg-red-100">
          {rejectedCount}スロット
        </Badge>
        {isAuditSaved && (
          <Badge variant="secondary">保存済み</Badge>
        )}
      </div>

      {isAuditSaved && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          セット鑑査結果は保存済みです。この画面からの再送信は無効化しました。
        </div>
      )}

      {/* Global action buttons */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          onClick={handleApproveAll}
          disabled={allSlotKeys.length === 0 || auditMutation.isPending || isAuditSaved}
          className="bg-green-700 text-white hover:bg-green-800"
        >
          <CheckCircle2 className="mr-1.5 size-3.5" aria-hidden="true" />
          全承認
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={handleSubmitAudit}
          disabled={allSlotKeys.length === 0 || auditMutation.isPending || isAuditSaved}
        >
          {approvedCount === allSlotKeys.length
            ? '承認を保存'
            : approvedCount > 0 && rejectedCount > 0
              ? '部分承認を保存'
              : rejectedCount === allSlotKeys.length && rejectedCount > 0
                ? '差戻しを保存'
                : '判定を保存'}
        </Button>
      </div>

      <Separator />

      {/* Day cards */}
      {days.length === 0 ? (
        <div className="rounded-md border border-muted bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground">
          バッチが登録されていません。セット計画編集から自動生成してください。
        </div>
      ) : (
        <div className="space-y-4">
          {days.map((day) => (
            <DayCard
              key={day.dayNumber}
              day={day}
              localApproval={localApproval}
              onApproveDay={handleApproveDay}
              onRejectDay={handleRejectDayOpen}
              isPending={auditMutation.isPending || isAuditSaved}
            />
          ))}
        </div>
      )}

      {/* Reject dialog */}
      <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              差戻し理由の入力
              {pendingRejectDayNumber !== null && ` — Day ${pendingRejectDayNumber}`}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="flex items-start gap-2 rounded-md border border-orange-200 bg-orange-50 px-3 py-2 text-xs text-orange-800">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              <span>差戻し後は再計画が必要です。</span>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reject-reason">差戻し理由コード</Label>
              <Select
                value={rejectReasonCode}
                onValueChange={(v) =>
                  setRejectReasonCode((v ?? '') as RejectReasonCode | '')
                }
              >
                <SelectTrigger id="reject-reason" aria-label="差戻し理由を選択">
                  <SelectValue placeholder="理由を選択" />
                </SelectTrigger>
                <SelectContent>
                  {REJECT_REASON_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reject-note">補足（任意）</Label>
              <Textarea
                id="reject-note"
                value={rejectNote}
                onChange={(e) => setRejectNote(e.target.value)}
                placeholder="詳細な差戻し理由や対応指示を入力"
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" size="sm" />}>
              キャンセル
            </DialogClose>
            <Button
              size="sm"
              variant="destructive"
              onClick={handleRejectConfirm}
              disabled={isAuditSaved}
            >
              差戻し実行
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
