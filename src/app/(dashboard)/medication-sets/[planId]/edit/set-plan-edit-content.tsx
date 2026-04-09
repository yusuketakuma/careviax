'use client';

import { useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { useRealtimeQuery } from '@/lib/hooks/use-realtime-query';
import { AlertTriangle, History, Loader2, Save, Wand2 } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { PreviousStageSummary } from '@/components/features/workflow/previous-stage-summary';
import { StageTimeline } from '@/components/features/workflow/stage-timeline';
import { SET_METHOD_LABELS, SET_METHOD_OPTIONS } from '@/lib/prescription/set-methods';

// --- Types ---

type PackagingSummary = {
  packaging_method_name: string | null;
  patient_default_method_label: string | null;
  medication_box_color: string | null;
  box_config: Record<string, string> | null;
  special_instructions: string[];
  tag_labels: string[];
};

type PackagingMethodRow = {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
};

type PrescriptionLine = {
  id: string;
  line_number: number;
  drug_name: string;
  drug_code: string | null;
  dose: string;
  frequency: string;
  days: number;
  unit: string | null;
  packaging_method: string | null;
  dosage_form: string | null;
  packaging_instructions: string | null;
  packaging_instruction_tags: string[];
  notes: string | null;
};

type PrescriptionIntake = {
  id: string;
  prescribed_date: string;
  prescriber_name: string | null;
  updated_at: string;
  lines: PrescriptionLine[];
};

type SetPlan = {
  id: string;
  cycle_id: string;
  target_period_start: string;
  target_period_end: string;
  set_method: string;
  packaging_method_id: string | null;
  packaging_summary_snapshot: PackagingSummary | null;
  notes: string | null;
  updated_at: string;
  stale_line_ids: string[];
  packaging_method_ref?: {
    id: string;
    name: string;
    description: string | null;
  } | null;
  cycle: {
    id: string;
    overall_status: string;
    patient_id: string;
    inquiries: Array<{ id: string }>;
    case_: {
      id: string;
      patient: {
        id: string;
        name: string;
        name_kana: string;
      };
    };
    prescription_intakes: PrescriptionIntake[];
  };
  audits: Array<{
    id: string;
    result: string;
    approved_scope: Record<string, unknown> | null;
    reject_reason: string | null;
    audited_at: string;
  }>;
  change_logs: Array<{
    id: string;
    action: string;
    trigger_source: string | null;
    reason: string | null;
    line_ids: string[] | null;
    before_snapshot: unknown;
    after_snapshot: unknown;
    changed_by: string | null;
    created_at: string;
    batch_id: string | null;
  }>;
};

type SetBatch = {
  id: string;
  plan_id: string;
  line_id: string;
  slot: string;
  day_number: number;
  quantity: number;
  carry_type: string;
  packaging_method_snapshot: string | null;
  packaging_instructions_snapshot: string | null;
  packaging_instruction_tags_snapshot: string[];
  version: number;
  updated_at: string;
  line: {
    id: string;
    drug_name: string;
    drug_code: string | null;
    dosage_form: string | null;
    dose: string;
    frequency: string;
    unit: string | null;
    packaging_method: string | null;
    packaging_instructions: string | null;
    packaging_instruction_tags: string[];
    notes: string | null;
  };
};

type CellKey = `${number}-${string}-${string}`; // day-slot-lineId

type DraftEdit = {
  batchId: string;
  quantity: number;
  slot: string;
  carryType: string;
  version: number;
};

type PlanForm = {
  target_period_start: string;
  target_period_end: string;
  set_method: string;
  packaging_method_id: string;
  notes: string;
};

// --- Constants ---

const SLOT_ORDER = ['morning', 'noon', 'evening', 'bedtime', 'prn'] as const;
type Slot = (typeof SLOT_ORDER)[number];

const SLOT_LABELS: Record<Slot, string> = {
  morning: '朝',
  noon: '昼',
  evening: '夕',
  bedtime: '眠前',
  prn: '頓用',
};

const SLOT_COLORS: Record<Slot, string> = {
  morning: 'bg-yellow-50 text-yellow-800 border-yellow-200',
  noon: 'bg-blue-50 text-blue-800 border-blue-200',
  evening: 'bg-orange-50 text-orange-800 border-orange-200',
  bedtime: 'bg-purple-50 text-purple-800 border-purple-200',
  prn: 'bg-gray-50 text-gray-700 border-gray-200',
};

const CARRY_TYPE_LABELS: Record<string, string> = {
  carry: '持参',
  facility_deposit: '施設預け',
  deferred: '後送',
};

// --- Helpers ---

function makeCellKey(day: number, slot: string, lineId: string): CellKey {
  return `${day}-${slot}-${lineId}` as CellKey;
}

function buildDayRange(start: string, end: string): number[] {
  const startDate = new Date(start);
  const endDate = new Date(end);
  const msPerDay = 1000 * 60 * 60 * 24;
  const totalDays = Math.max(1, Math.floor((endDate.getTime() - startDate.getTime()) / msPerDay) + 1);
  return Array.from({ length: totalDays }, (_, i) => i + 1);
}

function getSlotsUsed(batches: SetBatch[]): Slot[] {
  const found = new Set<Slot>();
  for (const b of batches) {
    if (SLOT_ORDER.includes(b.slot as Slot)) found.add(b.slot as Slot);
  }
  return SLOT_ORDER.filter((s) => found.has(s));
}

// --- Sub-components ---

function PrescriptionPanel({
  intakes,
  staleLineIds,
}: {
  intakes: PrescriptionIntake[];
  staleLineIds: Set<string>;
}) {
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle className="text-sm font-semibold">処方情報（読取専用）</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {intakes.length === 0 ? (
          <p className="text-sm text-muted-foreground">処方ラインがありません。</p>
        ) : (
          intakes.map((intake) => (
            <div key={intake.id} className="space-y-2">
              <p className="text-xs text-muted-foreground">
                処方日: {intake.prescribed_date.slice(0, 10)}
                {intake.prescriber_name ? ` / ${intake.prescriber_name}` : ''}
              </p>
              <ul className="space-y-1.5">
                {intake.lines.map((line) => (
                  <li
                    key={line.id}
                    className={`rounded-md border px-3 py-2 ${
                      staleLineIds.has(line.id)
                        ? 'border-amber-300 bg-amber-50'
                        : 'border-border bg-muted/30'
                    }`}
                  >
                    <p className="text-sm font-medium">{line.drug_name}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {line.dose} / {line.frequency} / {line.days}日分
                    </p>
                    {line.packaging_instructions ? (
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        包装: {line.packaging_instructions}
                      </p>
                    ) : null}
                    {staleLineIds.has(line.id) ? (
                      <p className="mt-1 text-[11px] font-medium text-amber-900">
                        セット生成後に変更あり
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

function SlotGridPanel({
  plan,
  batches,
  drafts,
  staleLineIds,
  onDraftChange,
}: {
  plan: SetPlan;
  batches: SetBatch[];
  drafts: Map<CellKey, DraftEdit>;
  staleLineIds: Set<string>;
  onDraftChange: (
    key: CellKey,
    batch: SetBatch,
    patch: Partial<Pick<DraftEdit, 'quantity' | 'slot' | 'carryType'>>
  ) => void;
}) {
  const days = buildDayRange(plan.target_period_start, plan.target_period_end);
  const usedSlots = getSlotsUsed(batches);

  const batchIndex = new Map<CellKey, SetBatch>();
  for (const b of batches) {
    const key = makeCellKey(b.day_number, b.slot, b.line_id);
    batchIndex.set(key, b);
  }

  if (usedSlots.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        バッチが生成されていません。「自動生成」ボタンを押してください。
      </p>
    );
  }

  // Collect unique lines per slot (using the line info embedded in each batch)
  const linesBySlot = new Map<Slot, SetBatch['line'][]>();
  for (const slot of usedSlots) {
    const lines = Array.from(
      new Map(
        batches
          .filter((b) => b.slot === slot)
          .map((b) => [b.line_id, b.line])
      ).values()
    );
    linesBySlot.set(slot, lines);
  }

  return (
    <div className="overflow-x-auto">
      <table
        className="min-w-full border-collapse text-xs"
        role="grid"
        aria-label="セットスロットグリッド"
      >
        <thead>
          <tr>
            <th className="border border-border bg-muted px-2 py-1.5 text-left font-medium text-muted-foreground whitespace-nowrap">
              スロット / 薬剤
            </th>
            {days.map((d) => (
              <th
                key={d}
                className="border border-border bg-muted px-2 py-1.5 text-center font-medium text-muted-foreground min-w-[64px]"
              >
                {d}日目
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {usedSlots.map((slot) => {
            const lines = linesBySlot.get(slot) ?? [];
            return lines.map((line, lineIdx) => (
              <tr key={`${slot}-${line.id}`}>
                <td
                  className={`border border-border px-2 py-1.5 font-medium whitespace-nowrap ${SLOT_COLORS[slot]} ${
                    staleLineIds.has(line.id) ? 'ring-1 ring-amber-300 ring-inset bg-amber-50/80' : ''
                  }`}
                >
                  {lineIdx === 0 && (
                    <Badge
                      variant="outline"
                      className={`mb-1 text-[10px] ${SLOT_COLORS[slot]}`}
                    >
                      {SLOT_LABELS[slot]}
                    </Badge>
                  )}
                  <p className="text-xs">{line.drug_name}</p>
                  <p className="text-[10px] text-muted-foreground">{line.dose}</p>
                  {staleLineIds.has(line.id) ? (
                    <p className="mt-1 text-[10px] font-medium text-amber-900">処方変更あり</p>
                  ) : null}
                </td>
                {days.map((day) => {
                  const cellKey = makeCellKey(day, slot, line.id);
                  const batch = batchIndex.get(cellKey);
                  const draft = drafts.get(cellKey);
                  const displayQty = draft?.quantity ?? batch?.quantity ?? 0;
                  const displaySlot = draft?.slot ?? batch?.slot ?? slot;
                  const displayCarryType = draft?.carryType ?? batch?.carry_type ?? 'carry';

                  return (
                    <td
                      key={day}
                      className="border border-border px-1 py-1 text-center align-middle"
                    >
                      {batch ? (
                        <div className="space-y-1">
                          <Input
                            type="number"
                            min={0}
                            step={0.5}
                            value={displayQty}
                            onChange={(e) => {
                              const val = parseFloat(e.target.value);
                              if (!isNaN(val) && val >= 0) {
                                onDraftChange(cellKey, batch, { quantity: val });
                              }
                            }}
                            className="h-7 w-16 text-center text-xs"
                            aria-label={`${day}日目 ${SLOT_LABELS[slot]} ${line.drug_name} 数量`}
                          />
                          <Select
                            value={displaySlot}
                            onValueChange={(value) => {
                              if (!value) return;
                              onDraftChange(cellKey, batch, { slot: value });
                            }}
                          >
                            <SelectTrigger className="h-7 w-full text-[10px]">
                              <SelectValue placeholder="時間帯" />
                            </SelectTrigger>
                            <SelectContent>
                              {SLOT_ORDER.map((slotOption) => (
                                <SelectItem key={slotOption} value={slotOption}>
                                  {SLOT_LABELS[slotOption]}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Select
                            value={displayCarryType}
                            onValueChange={(value) => {
                              if (!value) return;
                              onDraftChange(cellKey, batch, { carryType: value });
                            }}
                          >
                            <SelectTrigger className="h-7 w-full text-[10px]">
                              <SelectValue placeholder="持参区分" />
                            </SelectTrigger>
                            <SelectContent>
                              {Object.entries(CARRY_TYPE_LABELS).map(([value, label]) => (
                                <SelectItem key={value} value={value}>
                                  {label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ));
          })}
        </tbody>
      </table>
    </div>
  );
}

// --- Main ---

export function SetPlanEditContent() {
  const { planId } = useParams<{ planId: string }>();
  const queryClient = useQueryClient();
  const orgId = useOrgId();

  const [drafts, setDrafts] = useState<Map<CellKey, DraftEdit>>(new Map());
  const [planForm, setPlanForm] = useState<PlanForm | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [confirmRegenerateOpen, setConfirmRegenerateOpen] = useState(false);

  const { data: plan, isLoading: planLoading } = useRealtimeQuery({
    queryKey: ['set-plan', planId],
    queryFn: async () => {
      const res = await fetch(`/api/set-plans/${planId}`, {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('セットプランの取得に失敗しました');
      const json = await res.json() as { data: SetPlan };
      return json.data;
    },
    enabled: Boolean(planId && orgId),
    invalidateOn: ['cycle_transition', 'workflow_refresh'],
  });

  const { data: batches = [], isLoading: batchesLoading } = useRealtimeQuery({
    queryKey: ['set-batches', planId],
    queryFn: async () => {
      const res = await fetch(`/api/set-batches?plan_id=${planId}`, {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('セットバッチの取得に失敗しました');
      const json = await res.json() as { data: SetBatch[] };
      return json.data;
    },
    enabled: Boolean(planId && orgId),
    invalidateOn: ['cycle_transition', 'workflow_refresh'],
  });

  const packagingMethodsQuery = useQuery({
    queryKey: ['packaging-methods', orgId],
    queryFn: async () => {
      const res = await fetch('/api/packaging-methods', {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('配薬方法マスタの取得に失敗しました');
      const json = (await res.json()) as { data: PackagingMethodRow[] };
      return json.data.filter((method) => method.is_active);
    },
    enabled: Boolean(orgId),
  });

  const planUpdateMutation = useMutation({
    mutationFn: async (form: PlanForm) => {
      const res = await fetch(`/api/set-plans/${planId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-org-id': orgId },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { message?: string };
        throw new Error(err.message ?? 'セットプランの更新に失敗しました');
      }
      return res.json() as Promise<{ data: SetPlan }>;
    },
    onSuccess: ({ data: updatedPlan }) => {
      void queryClient.invalidateQueries({ queryKey: ['set-plan', planId] });
      setPlanForm({
        target_period_start: updatedPlan.target_period_start.slice(0, 10),
        target_period_end: updatedPlan.target_period_end.slice(0, 10),
        set_method: updatedPlan.set_method,
        packaging_method_id: updatedPlan.packaging_method_id ?? '',
        notes: updatedPlan.notes ?? '',
      });
      toast.success('セット計画を更新しました');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const generateMutation = useMutation({
    mutationFn: async (force: boolean) => {
      const res = await fetch(`/api/set-plans/${planId}/generate-batches`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-org-id': orgId },
        body: JSON.stringify({ force }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { message?: string };
        throw new Error(err.message ?? 'バッチ生成に失敗しました');
      }
      return res.json();
    },
    onSuccess: (data: { data: { count: number } }) => {
      queryClient.invalidateQueries({ queryKey: ['set-batches', planId] });
      setDrafts(new Map());
      toast.success(`${data.data.count}件のバッチを生成しました`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const saveMutation = useMutation({
    mutationFn: async (
      editList: Array<{
        id: string;
        quantity: number;
        slot: string;
        carry_type: string;
        version: number;
      }>
    ) => {
      const results = await Promise.allSettled(
        editList.map(({ id, quantity, version, ...rest }) =>
          fetch(`/api/set-batches/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', 'x-org-id': orgId },
            body: JSON.stringify({ quantity, version, ...rest }),
          }).then((r) => {
            if (!r.ok) throw new Error(`バッチ ${id} の更新に失敗しました`);
            return r.json();
          })
        )
      );

      const failed = results.filter((r) => r.status === 'rejected');
      if (failed.length > 0) {
        throw new Error(`${failed.length}件の更新に失敗しました`);
      }
      return results;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['set-batches', planId] });
      setDrafts(new Map());
      toast.success('変更を保存しました');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const handleQuantityChange = useCallback(
    (key: CellKey, batch: SetBatch, patch: Partial<Pick<DraftEdit, 'quantity' | 'slot' | 'carryType'>>) => {
      setDrafts((prev) => {
        const next = new Map(prev);
        const current = next.get(key) ?? {
          batchId: batch.id,
          quantity: batch.quantity,
          slot: batch.slot,
          carryType: batch.carry_type,
          version: batch.version,
        };
        next.set(key, {
          ...current,
          ...patch,
        });
        return next;
      });
    },
    []
  );

  function handleSave() {
    if (drafts.size === 0) {
      toast.info('変更はありません');
      return;
    }
    const editList = Array.from(drafts.values()).map(({ batchId, quantity, slot, carryType, version }) => ({
      id: batchId,
      quantity,
      slot,
      carry_type: carryType,
      version,
    }));
    saveMutation.mutate(editList);
  }

  function handleGenerate() {
    if (batches.length > 0) {
      setConfirmRegenerateOpen(true);
    } else {
      generateMutation.mutate(false);
    }
  }

  const isLoading = planLoading || batchesLoading;
  const intakes = plan?.cycle?.prescription_intakes ?? [];
  const resolvedPlanForm: PlanForm =
    planForm ??
    (plan
      ? {
          target_period_start: plan.target_period_start.slice(0, 10),
          target_period_end: plan.target_period_end.slice(0, 10),
          set_method: plan.set_method,
          packaging_method_id: plan.packaging_method_id ?? '',
          notes: plan.notes ?? '',
        }
      : {
          target_period_start: '',
          target_period_end: '',
          set_method: 'facility_calendar',
          packaging_method_id: '',
          notes: '',
        });
  const hasPendingInquiry = (plan?.cycle.inquiries.length ?? 0) > 0;
  const latestIntakeUpdatedAt = intakes.reduce<string | null>((latest, intake) => {
    if (!latest || intake.updated_at > latest) return intake.updated_at;
    return latest;
  }, null);
  const latestBatchUpdatedAt = batches.reduce<string | null>((latest, batch) => {
    if (!latest || batch.updated_at > latest) return batch.updated_at;
    return latest;
  }, null);
  const requiresRegeneration =
    latestIntakeUpdatedAt != null &&
    latestBatchUpdatedAt != null &&
    latestIntakeUpdatedAt > latestBatchUpdatedAt;
  const hasBlockedCycle = plan != null && !['audited', 'setting', 'set_audited'].includes(plan.cycle.overall_status);
  const carryCounts = batches.reduce<Record<string, number>>((acc, batch) => {
    acc[batch.carry_type] = (acc[batch.carry_type] ?? 0) + 1;
    return acc;
  }, {});
  const packagingMethods = packagingMethodsQuery.data ?? [];
  const staleLineIds = new Set(plan?.stale_line_ids ?? []);
  const planDirty =
    plan != null &&
    (resolvedPlanForm.target_period_start !== plan.target_period_start.slice(0, 10) ||
      resolvedPlanForm.target_period_end !== plan.target_period_end.slice(0, 10) ||
      resolvedPlanForm.set_method !== plan.set_method ||
      resolvedPlanForm.packaging_method_id !== (plan.packaging_method_id ?? '') ||
      resolvedPlanForm.notes !== (plan.notes ?? ''));

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden="true" />
        <span className="ml-2 text-sm text-muted-foreground">読み込み中...</span>
      </div>
    );
  }

  if (!plan) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
        セットプランが見つかりません。
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ConfirmDialog
        open={confirmRegenerateOpen}
        onOpenChange={setConfirmRegenerateOpen}
        title="既存バッチを再生成しますか？"
        description="現在のバッチを削除して、最新の処方内容と患者設定から再生成します。"
        confirmLabel="再生成する"
        onConfirm={() => generateMutation.mutate(true)}
      />
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <PreviousStageSummary cycleId={plan.cycle_id} />
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setHistoryOpen(true)}
        >
          <History className="mr-1.5 size-3.5" aria-hidden="true" />
          履歴
        </Button>
      </div>

      <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>ステータス遷移履歴</SheetTitle>
            <SheetDescription>処方サイクルのステータス変更履歴</SheetDescription>
          </SheetHeader>
          <div className="mt-4">
            <StageTimeline cycleId={plan.cycle_id} />
          </div>
        </SheetContent>
      </Sheet>

      {/* Header actions */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-muted-foreground">
            患者: {plan.cycle.case_.patient.name} / 対象期間: {plan.target_period_start.slice(0, 10)} 〜 {plan.target_period_end.slice(0, 10)}
            {' / '}方式: {SET_METHOD_LABELS[plan.set_method as keyof typeof SET_METHOD_LABELS] ?? plan.set_method}
            {plan.packaging_summary_snapshot?.packaging_method_name
              ? ` / 配薬: ${plan.packaging_summary_snapshot.packaging_method_name}`
              : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={handleGenerate}
            disabled={generateMutation.isPending}
          >
            {generateMutation.isPending ? (
              <Loader2 className="mr-1.5 size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Wand2 className="mr-1.5 size-3.5" aria-hidden="true" />
            )}
            自動生成
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={drafts.size === 0 || saveMutation.isPending}
          >
            {saveMutation.isPending ? (
              <Loader2 className="mr-1.5 size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Save className="mr-1.5 size-3.5" aria-hidden="true" />
            )}
            保存 {drafts.size > 0 ? `(${drafts.size}件)` : ''}
          </Button>
          <a
            href={`/medication-sets/full?plan_id=${plan.id}`}
            className="inline-flex h-7 items-center rounded-[min(var(--radius-md),12px)] border border-border bg-background px-2.5 text-[0.8rem] font-medium text-foreground hover:bg-muted"
          >
            持参パック表示
          </a>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold">セット計画</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-[1fr_1fr_1.3fr]">
          <div className="space-y-1.5">
            <Label htmlFor="set-period-start">対象期間開始</Label>
            <Input
              id="set-period-start"
              type="date"
              value={resolvedPlanForm.target_period_start}
              onChange={(event) =>
                setPlanForm((current) => ({
                  ...(current ?? resolvedPlanForm),
                  target_period_start: event.target.value,
                }))
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="set-period-end">対象期間終了</Label>
            <Input
              id="set-period-end"
              type="date"
              value={resolvedPlanForm.target_period_end}
              onChange={(event) =>
                setPlanForm((current) => ({
                  ...(current ?? resolvedPlanForm),
                  target_period_end: event.target.value,
                }))
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="set-method">セット方式</Label>
            <Select
              value={resolvedPlanForm.set_method}
              onValueChange={(value) => {
                if (!value) return;
                setPlanForm((current) => ({
                  ...(current ?? resolvedPlanForm),
                  set_method: value,
                }));
              }}
            >
              <SelectTrigger id="set-method">
                <SelectValue placeholder="セット方式を選択" />
              </SelectTrigger>
              <SelectContent>
                {SET_METHOD_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="set-packaging-method">配薬方法</Label>
            <Select
              value={resolvedPlanForm.packaging_method_id || 'none'}
              onValueChange={(value) => {
                const nextPackagingMethodId = value === 'none' ? '' : String(value);
                setPlanForm((current) => ({
                  ...(current ?? resolvedPlanForm),
                  packaging_method_id: nextPackagingMethodId,
                }));
              }}
            >
              <SelectTrigger id="set-packaging-method">
                <SelectValue placeholder="患者設定を使用" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">患者設定を使用</SelectItem>
                {packagingMethods.map((method) => (
                  <SelectItem key={method.id} value={method.id}>
                    {method.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 lg:col-span-3">
            <Label htmlFor="set-notes">備考</Label>
            <Textarea
              id="set-notes"
              rows={2}
              value={resolvedPlanForm.notes}
              onChange={(event) =>
                setPlanForm((current) => ({
                  ...(current ?? resolvedPlanForm),
                  notes: event.target.value,
                }))
              }
              placeholder="施設カレンダーや患者事情、セット時の注意事項を記録"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2 lg:col-span-3">
            <Badge variant="outline">cycle {plan.cycle.id}</Badge>
            <Badge variant="outline">状態 {plan.cycle.overall_status}</Badge>
            <Badge variant="outline">持参 {carryCounts.carry ?? 0}</Badge>
            <Badge variant="outline">施設預け {carryCounts.facility_deposit ?? 0}</Badge>
            <Badge variant="outline">後送 {carryCounts.deferred ?? 0}</Badge>
            {plan.packaging_summary_snapshot?.tag_labels.map((label) => (
              <Badge key={label} variant="outline">
                {label}
              </Badge>
            ))}
            <Button
              size="sm"
              variant="outline"
              onClick={() => planUpdateMutation.mutate(resolvedPlanForm)}
              disabled={!planDirty || planUpdateMutation.isPending}
            >
              計画を更新
            </Button>
          </div>
          <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-3 lg:col-span-3">
            <p className="text-sm font-medium text-foreground">配薬指示サマリー</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {plan.packaging_summary_snapshot?.packaging_method_name ??
                plan.packaging_summary_snapshot?.patient_default_method_label ??
                '患者配薬設定を参照中'}
            </p>
            {plan.packaging_summary_snapshot?.medication_box_color ? (
              <p className="mt-1 text-xs text-muted-foreground">
                BOX色: {plan.packaging_summary_snapshot.medication_box_color}
              </p>
            ) : null}
            {plan.packaging_summary_snapshot?.box_config ? (
              <p className="mt-1 text-xs text-muted-foreground">
                BOX割当:{' '}
                {Object.entries(plan.packaging_summary_snapshot.box_config)
                  .map(([slot, color]) => `${slot}=${color}`)
                  .join(' / ')}
              </p>
            ) : null}
            {plan.packaging_summary_snapshot?.special_instructions?.length ? (
              <ul className="mt-2 space-y-1 text-xs text-foreground">
                {plan.packaging_summary_snapshot.special_instructions.map((instruction) => (
                  <li key={instruction}>- {instruction}</li>
                ))}
              </ul>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {(hasBlockedCycle || hasPendingInquiry || requiresRegeneration) && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <div className="space-y-1">
              <p className="font-medium">セット前の再確認が必要です</p>
              {hasBlockedCycle ? (
                <p>鑑査未承認のサイクル状態のため、セット生成は再確認後に行ってください。</p>
              ) : null}
              {hasPendingInquiry ? (
                <p>未解決の疑義照会があります。確定後にセット内容を再確認してください。</p>
              ) : null}
              {requiresRegeneration ? (
                <p>処方変更がセット生成後に発生しています。影響セットを確認して再生成してください。</p>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {/* Two-panel layout */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[280px_1fr]">
        {/* Left: prescription info */}
        <PrescriptionPanel intakes={intakes} staleLineIds={staleLineIds} />

        {/* Right: slot grid */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-semibold">スロットグリッド（編集可）</CardTitle>
          </CardHeader>
          <CardContent>
            <SlotGridPanel
              plan={plan}
              batches={batches}
              drafts={drafts}
              staleLineIds={staleLineIds}
              onDraftChange={handleQuantityChange}
            />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold">変更履歴</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {plan.change_logs.length === 0 ? (
            <p className="text-sm text-muted-foreground">変更履歴はまだありません。</p>
          ) : (
            plan.change_logs.map((log) => {
              const lineIds = Array.isArray(log.line_ids) ? log.line_ids : [];
              const beforeCount = Array.isArray(log.before_snapshot) ? log.before_snapshot.length : 0;
              const afterCount = Array.isArray(log.after_snapshot) ? log.after_snapshot.length : 0;
              return (
                <div key={log.id} className="rounded-lg border border-border/60 bg-background px-3 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{log.action}</Badge>
                    {log.trigger_source ? <Badge variant="secondary">{log.trigger_source}</Badge> : null}
                    <span className="text-xs text-muted-foreground">
                      {log.created_at.slice(0, 16).replace('T', ' ')}
                    </span>
                  </div>
                  {log.reason ? <p className="mt-2 text-sm">{log.reason}</p> : null}
                  <p className="mt-1 text-xs text-muted-foreground">
                    before {beforeCount}件 / after {afterCount}件
                    {lineIds.length > 0 ? ` / 影響ライン: ${lineIds.join(', ')}` : ''}
                  </p>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}
