'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2,
  XCircle,
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
import { Separator } from '@/components/ui/separator';
import {
  ReasonDialog,
  type ReasonSubmission,
} from '@/components/features/workflow/reason-dialog';
import {
  buildSetAuditHydrationState,
  buildSetAuditSubmission,
  groupBatchesByDayAndSlot,
  type DayGroup,
  type SlotGroup,
} from './set-audit-content.helpers';

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

type SetPlanAuditDetails = {
  audits: Array<{
    id: string;
    result: 'approved' | 'partial_approved' | 'rejected' | string;
    approved_scope: Record<string, unknown> | null;
    reject_reason: string | null;
    audited_at: string;
  }>;
  batches: Array<{
    id: string;
    updated_at: string;
  }>;
};

// ── Constants ──

const CARRY_TYPE_LABELS: Record<string, string> = {
  carry: '持参',
  facility_deposit: '施設預け',
  deferred: '後日対応',
};

const REJECT_REASON_OPTIONS = [
  { code: 'drug_mismatch', label: '薬剤不一致' },
  { code: 'quantity_error', label: '数量誤り' },
  { code: 'patient_change', label: '患者状態変化' },
  { code: 'prescription_expired', label: '処方期限切れ' },
  { code: 'other', label: 'その他' },
] as const;

// ── Sub-components ──

function SlotGroupCard({
  slotGroup,
  approvalState,
}: {
  slotGroup: SlotGroup<SetBatch>;
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
  day: DayGroup<SetBatch>;
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
  const [draftApproval, setDraftApproval] = useState<Map<string, boolean | null> | null>(null);
  const [draftRejectReasonsByDay, setDraftRejectReasonsByDay] = useState<Map<number, string> | null>(null);
  const [isAuditSaved, setIsAuditSaved] = useState(false);

  // reject dialog state
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [pendingRejectDayNumber, setPendingRejectDayNumber] = useState<number | null>(null);

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

  const planQuery = useRealtimeQuery({
    queryKey: ['set-plan-audit', planId],
    queryFn: async () => {
      const res = await fetch(`/api/set-plans/${planId}`, {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('セットプランの取得に失敗しました');
      const json = (await res.json()) as { data: SetPlanAuditDetails };
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
      queryClient.invalidateQueries({ queryKey: ['set-plan-audit', planId] });
    },
  });

  const rawBatches = data ?? [];
  const days = groupBatchesByDayAndSlot(rawBatches);

  // Summary counts at slot level
  const allSlotKeys = days.flatMap((day) =>
    day.slots.map((s) => `${day.dayNumber}-${s.slot}`)
  );
  const latestAudit = planQuery.data?.audits[0] ?? null;
  const latestBatchUpdatedAt =
    planQuery.data?.batches.reduce<string | null>((latest, batch) => {
      return !latest || batch.updated_at > latest ? batch.updated_at : latest;
    }, null) ?? null;
  const allowHydration =
    !latestAudit ||
    !latestBatchUpdatedAt ||
    latestAudit.audited_at >= latestBatchUpdatedAt;
  const hydratedAuditState = buildSetAuditHydrationState({
    allSlotKeys,
    latestAudit,
    allowHydration,
  });
  const localApproval = draftApproval ?? hydratedAuditState.localApproval;
  const rejectReasonsByDay =
    draftRejectReasonsByDay ?? hydratedAuditState.rejectReasonsByDay;
  const approvedCount = allSlotKeys.filter((k) => localApproval.get(k) === true).length;
  const rejectedCount = allSlotKeys.filter((k) => localApproval.get(k) === false).length;
  const pendingCount = allSlotKeys.length - approvedCount - rejectedCount;

  // Approve all slots in a day
  function handleApproveDay(dayNumber: number) {
    const day = days.find((d) => d.dayNumber === dayNumber);
    if (!day) return;

    const keys = day.slots.map((s) => `${dayNumber}-${s.slot}`);
    setDraftApproval((prev) => {
      const next = new Map(prev ?? localApproval);
      for (const k of keys) next.set(k, true);
      return next;
    });
    setDraftRejectReasonsByDay((prev) => {
      const next = new Map(prev ?? rejectReasonsByDay);
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
  function handleRejectConfirm({ label, note }: ReasonSubmission) {
    if (pendingRejectDayNumber === null) return;
    if (isAuditSaved) {
      toast.error('監査は保存済みのため差戻しできません');
      return;
    }

    const day = days.find((d) => d.dayNumber === pendingRejectDayNumber);
    if (!day) return;

    const keys = day.slots.map((s) => `${pendingRejectDayNumber}-${s.slot}`);
    setDraftApproval((prev) => {
      const next = new Map(prev ?? localApproval);
      for (const k of keys) next.set(k, false);
      return next;
    });

    const rejectText = note ? `${label}: ${note}` : label;
    setDraftRejectReasonsByDay((prev) => {
      const next = new Map(prev ?? rejectReasonsByDay);
      next.set(pendingRejectDayNumber, rejectText);
      return next;
    });
    toast.success(`Day ${pendingRejectDayNumber} を差戻し候補としてマークしました`);

    setRejectDialogOpen(false);
    setPendingRejectDayNumber(null);
  }

  // Approve all pending days
  function handleApproveAll() {
    if (allSlotKeys.length === 0) {
      toast.warning('セットバッチがありません');
      return;
    }

    const allKeys = allSlotKeys;
    setDraftApproval((prev) => {
      const next = new Map(prev ?? localApproval);
      for (const k of allKeys) next.set(k, true);
      return next;
    });
    setDraftRejectReasonsByDay(new Map());
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

  if (!orgId || isLoading || planQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden="true" />
        <span className="ml-2 text-sm text-muted-foreground">読み込み中...</span>
      </div>
    );
  }

  if (isError || planQuery.isError) {
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

      {/* Reject dialog — p0_36 共通理由モーダル */}
      <ReasonDialog
        open={rejectDialogOpen}
        onOpenChange={(open) => {
          setRejectDialogOpen(open);
          if (!open) setPendingRejectDayNumber(null);
        }}
        title={
          pendingRejectDayNumber !== null
            ? `差し戻し理由を入力 — Day ${pendingRejectDayNumber}`
            : '差し戻し理由を入力'
        }
        options={REJECT_REASON_OPTIONS}
        warning="差戻し後は再計画が必要です。"
        onSubmit={handleRejectConfirm}
      />
    </div>
  );
}
