'use client';

import { useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { Loader2, Wand2, Save } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

// --- Types ---

type PrescriptionLine = {
  id: string;
  drug_name: string;
  dose: string;
  frequency: string;
  days: number;
  unit: string | null;
};

type PrescriptionIntake = {
  id: string;
  prescribed_date: string;
  prescriber_name: string | null;
  lines: PrescriptionLine[];
};

type SetPlan = {
  id: string;
  cycle_id: string;
  target_period_start: string;
  target_period_end: string;
  set_method: string;
  notes: string | null;
  cycle: {
    prescription_intakes: PrescriptionIntake[];
  };
};

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

type CellKey = `${number}-${string}-${string}`; // day-slot-lineId

type DraftEdit = {
  batchId: string;
  quantity: number;
  version: number;
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

function PrescriptionPanel({ intakes }: { intakes: PrescriptionIntake[] }) {
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
                  <li key={line.id} className="rounded-md border border-border bg-muted/30 px-3 py-2">
                    <p className="text-sm font-medium">{line.drug_name}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {line.dose} / {line.frequency} / {line.days}日分
                    </p>
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
  onQuantityChange,
}: {
  plan: SetPlan;
  batches: SetBatch[];
  drafts: Map<CellKey, DraftEdit>;
  onQuantityChange: (key: CellKey, batchId: string, version: number, quantity: number) => void;
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
                  className={`border border-border px-2 py-1.5 font-medium whitespace-nowrap ${SLOT_COLORS[slot]}`}
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
                </td>
                {days.map((day) => {
                  const cellKey = makeCellKey(day, slot, line.id);
                  const batch = batchIndex.get(cellKey);
                  const draft = drafts.get(cellKey);
                  const displayQty = draft?.quantity ?? batch?.quantity ?? 0;

                  return (
                    <td
                      key={day}
                      className="border border-border px-1 py-1 text-center align-middle"
                    >
                      {batch ? (
                        <Input
                          type="number"
                          min={0}
                          step={0.5}
                          value={displayQty}
                          onChange={(e) => {
                            if (!batch) return;
                            const val = parseFloat(e.target.value);
                            if (!isNaN(val) && val >= 0) {
                              onQuantityChange(cellKey, batch.id, batch.version, val);
                            }
                          }}
                          className="h-7 w-16 text-center text-xs"
                          aria-label={`${day}日目 ${SLOT_LABELS[slot]} ${line.drug_name} 数量`}
                        />
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

  const { data: plan, isLoading: planLoading } = useQuery({
    queryKey: ['set-plan', planId],
    queryFn: async () => {
      const res = await fetch(`/api/set-plans?cycle_id=`, {
        headers: { 'x-org-id': orgId },
      });
      // Fetch the specific plan — use set-plans listing and filter client-side
      // In a real implementation, a dedicated GET /api/set-plans/[planId] endpoint would be preferred
      if (!res.ok) throw new Error('セットプランの取得に失敗しました');
      const json = await res.json() as { data: Array<SetPlan & { id: string }> };
      return json.data.find((p) => p.id === planId) ?? null;
    },
    enabled: Boolean(planId),
  });

  const { data: batches = [], isLoading: batchesLoading } = useQuery({
    queryKey: ['set-batches', planId],
    queryFn: async () => {
      const res = await fetch(`/api/set-batches?plan_id=${planId}`, {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('セットバッチの取得に失敗しました');
      const json = await res.json() as { data: SetBatch[] };
      return json.data;
    },
    enabled: Boolean(planId),
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
    mutationFn: async (editList: Array<{ id: string; quantity: number; version: number }>) => {
      const results = await Promise.allSettled(
        editList.map(({ id, quantity, version }) =>
          fetch(`/api/set-batches/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', 'x-org-id': orgId },
            body: JSON.stringify({ quantity, version }),
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
    (key: CellKey, batchId: string, version: number, quantity: number) => {
      setDrafts((prev) => {
        const next = new Map(prev);
        next.set(key, { batchId, quantity, version });
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
    const editList = Array.from(drafts.values()).map(({ batchId, quantity, version }) => ({
      id: batchId,
      quantity,
      version,
    }));
    saveMutation.mutate(editList);
  }

  function handleGenerate() {
    if (batches.length > 0) {
      if (!confirm('既存のバッチを削除して再生成します。よろしいですか？')) return;
      generateMutation.mutate(true);
    } else {
      generateMutation.mutate(false);
    }
  }

  const isLoading = planLoading || batchesLoading;
  const intakes = plan?.cycle?.prescription_intakes ?? [];

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
      {/* Header actions */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-muted-foreground">
            対象期間: {plan.target_period_start.slice(0, 10)} 〜 {plan.target_period_end.slice(0, 10)}
            {' / '}方式: {plan.set_method}
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
        </div>
      </div>

      {/* Two-panel layout */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[280px_1fr]">
        {/* Left: prescription info */}
        <PrescriptionPanel intakes={intakes} />

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
              onQuantityChange={handleQuantityChange}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
