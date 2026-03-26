'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ChevronLeft, CheckSquare, Square } from 'lucide-react';
import Link from 'next/link';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loading } from '@/components/ui/loading';
import { CdsAlertPanel, type CdsAlert } from '@/components/features/cds/alert-panel';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PrescriptionLine = {
  id: string;
  line_number: number;
  drug_name: string;
  drug_code: string | null;
  dosage_form: string | null;
  dose: string;
  frequency: string;
  days: number;
  quantity: number | null;
  unit: string | null;
  packaging_instructions: string | null;
  notes: string | null;
};

type DispenseResult = {
  id: string;
  line_id: string;
  actual_drug_name: string;
  actual_drug_code: string | null;
  actual_quantity: number;
  actual_unit: string | null;
  discrepancy_reason: string | null;
  carry_type: 'carry' | 'facility_deposit' | 'deferred';
  special_notes: string | null;
  dispensed_at: string;
};

type DispenseTaskDetail = {
  id: string;
  priority: string;
  status: string;
  cycle_id: string;
  cycle: {
    id: string;
    patient_id: string;
    case_: {
      patient: {
        id: string;
        name: string;
        name_kana: string;
      };
    };
    prescription_intakes: Array<{
      id: string;
      prescribed_date: string;
      prescriber_name: string | null;
      prescriber_institution: string | null;
      lines: PrescriptionLine[];
    }>;
  };
  results: DispenseResult[];
};

// ---------------------------------------------------------------------------
// Checklist items
// ---------------------------------------------------------------------------

const CHECKLIST_ITEMS = [
  { id: 'patient_name', label: '患者氏名が正しいことを確認しました', required: true },
  {
    id: 'drug_match',
    label: '全薬剤の名称・規格が処方と一致していることを確認しました',
    required: true,
  },
  {
    id: 'quantity_match',
    label: '数量・日数が処方と一致していることを確認しました',
    required: true,
  },
  {
    id: 'dosage_form',
    label: '用法が正しく入力されていることを確認しました',
    required: true,
  },
  {
    id: 'high_risk',
    label: '高リスク薬（抗凝固薬・インスリン・麻薬等）の取扱を確認しました',
    required: false,
  },
  { id: 'cold_storage', label: '冷所保管薬の取扱を確認しました', required: false },
  { id: 'packaging', label: '包装指示を確認しました', required: true },
] as const;

type ChecklistItemId = (typeof CHECKLIST_ITEMS)[number]['id'];

// ---------------------------------------------------------------------------
// High-risk / cold-storage detection
// ---------------------------------------------------------------------------

const HIGH_RISK_KEYWORDS = [
  'ワーファリン',
  'インスリン',
  '麻薬',
  'ヘパリン',
  'リチウム',
  'ジゴキシン',
  'テオフィリン',
];

function hasHighRiskDrug(results: DispenseResult[]): boolean {
  return results.some((r) =>
    HIGH_RISK_KEYWORDS.some((kw) => r.actual_drug_name.includes(kw))
  );
}

function hasColdStorageDrug(results: DispenseResult[]): boolean {
  return results.some((r) => r.special_notes?.includes('冷所'));
}

// ---------------------------------------------------------------------------
// Priority badge
// ---------------------------------------------------------------------------

const PRIORITY_LABEL: Record<string, string> = {
  emergency: '緊急',
  urgent: '至急',
  normal: '通常',
};

const PRIORITY_VARIANT: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  emergency: 'destructive',
  urgent: 'secondary',
  normal: 'outline',
};

const CARRY_TYPE_LABEL: Record<string, string> = {
  carry: '持参',
  facility_deposit: '施設預け',
  deferred: '後日対応',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DispenseConfirmContent() {
  const params = useParams();
  const taskId = typeof params.taskId === 'string' ? params.taskId : '';
  const router = useRouter();
  const orgId = useOrgId();

  const [checked, setChecked] = useState<Record<ChecklistItemId, boolean>>({
    patient_name: false,
    drug_match: false,
    quantity_match: false,
    dosage_form: false,
    high_risk: false,
    cold_storage: false,
    packaging: false,
  });

  // Fetch task detail
  const { data: task, isLoading } = useQuery<DispenseTaskDetail>({
    queryKey: ['dispense-task-detail', taskId, orgId],
    queryFn: async () => {
      const res = await fetch(`/api/dispense-tasks/${taskId}`, {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('タスク詳細の取得に失敗しました');
      return res.json() as Promise<DispenseTaskDetail>;
    },
    enabled: !!orgId && !!taskId,
  });

  // Fetch CDS alerts
  const { data: cdsData, isLoading: cdsLoading } = useQuery<{ alerts: CdsAlert[] }>({
    queryKey: ['cds-alerts', task?.cycle_id, orgId],
    queryFn: async () => {
      const res = await fetch('/api/cds/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-org-id': orgId },
        body: JSON.stringify({ cycleId: task!.cycle_id }),
      });
      if (!res.ok) return { alerts: [] };
      return res.json() as Promise<{ alerts: CdsAlert[] }>;
    },
    enabled: !!orgId && !!task?.cycle_id,
  });

  // Submit dispense results
  const submitMutation = useMutation({
    mutationFn: async () => {
      if (!task) throw new Error('タスクデータがありません');

      const lines = task.results.map((r) => ({
        line_id: r.line_id,
        actual_drug_name: r.actual_drug_name,
        actual_drug_code: r.actual_drug_code ?? undefined,
        actual_quantity: r.actual_quantity,
        actual_unit: r.actual_unit ?? undefined,
        discrepancy_reason: r.discrepancy_reason ?? undefined,
        carry_type: r.carry_type,
        special_notes: r.special_notes ?? undefined,
      }));

      const res = await fetch('/api/dispense-results', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-org-id': orgId },
        body: JSON.stringify({ task_id: taskId, lines }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { message?: string };
        throw new Error(err.message ?? '調剤完了の登録に失敗しました');
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success('調剤完了', { description: '調剤実績を登録しました' });
      router.push('/dispensing');
    },
    onError: (err: Error) => {
      toast.error('エラー', { description: err.message });
    },
  });

  if (isLoading) return <Loading />;
  if (!task) {
    return <p className="p-6 text-sm text-muted-foreground">調剤タスクが見つかりません</p>;
  }

  const patient = task.cycle.case_.patient;
  const intake = task.cycle.prescription_intakes[0];
  const results = task.results;

  const showHighRisk = hasHighRiskDrug(results);
  const showColdStorage = hasColdStorageDrug(results);

  // Visible checklist items (context-sensitive for optional ones)
  const visibleItems = CHECKLIST_ITEMS.filter((item) => {
    if (item.required) return true;
    if (item.id === 'high_risk') return showHighRisk;
    if (item.id === 'cold_storage') return showColdStorage;
    return true;
  });

  const requiredUnchecked = visibleItems.filter(
    (item) => item.required && !checked[item.id]
  );
  const isSubmitDisabled = requiredUnchecked.length > 0 || submitMutation.isPending;

  const toggleCheck = (id: ChecklistItemId) => {
    setChecked((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  // Build prescription line lookup map
  const prescriptionLineMap = new Map<string, PrescriptionLine>();
  intake?.lines.forEach((l) => prescriptionLineMap.set(l.id, l));

  return (
    <div className="p-4 md:p-6">
      {/* Page header */}
      <div className="mb-4">
        <Link
          href={`/dispensing/${taskId}`}
          className="inline-flex h-7 items-center gap-1 rounded-lg px-2.5 text-[0.8rem] font-medium text-foreground hover:bg-muted"
        >
          <ChevronLeft className="size-3.5" aria-hidden="true" />
          調剤入力へ戻る
        </Link>
      </div>

      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-foreground">
            調剤確認チェックリスト
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            全ての必須項目にチェックしてから調剤完了してください
          </p>
        </div>
      </div>

      <div className="mx-auto max-w-3xl space-y-6">
        {/* Patient / task summary */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center gap-3">
              <CardTitle className="text-base">{patient.name} 様</CardTitle>
              <Badge variant={PRIORITY_VARIANT[task.priority] ?? 'outline'}>
                {PRIORITY_LABEL[task.priority] ?? task.priority}
              </Badge>
            </div>
            {intake && (
              <p className="text-xs text-muted-foreground">
                処方日: {intake.prescribed_date.slice(0, 10)}
                {intake.prescriber_name && ` / 処方医: ${intake.prescriber_name}`}
                {intake.prescriber_institution && ` (${intake.prescriber_institution})`}
              </p>
            )}
          </CardHeader>
        </Card>

        {/* Prescription vs Dispense comparison table */}
        {results.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">処方 vs 調剤実績</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="pb-2 pr-3 font-medium">#</th>
                      <th className="pb-2 pr-3 font-medium">処方内容</th>
                      <th className="pb-2 font-medium">調剤実績</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {results.map((result, index) => {
                      const prescribed = prescriptionLineMap.get(result.line_id);
                      const hasDrugDiscrepancy =
                        prescribed &&
                        result.actual_drug_name !== prescribed.drug_name;
                      const hasQtyDiscrepancy =
                        prescribed &&
                        result.actual_quantity !== (prescribed.quantity ?? result.actual_quantity);

                      return (
                        <tr
                          key={result.id}
                          className={cn(
                            'align-top',
                            (hasDrugDiscrepancy || hasQtyDiscrepancy) && 'bg-destructive/5'
                          )}
                        >
                          <td className="py-2 pr-3 font-medium text-muted-foreground">
                            {index + 1}
                          </td>
                          {/* Prescribed */}
                          <td className="py-2 pr-3">
                            <p className="font-medium">{prescribed?.drug_name ?? '—'}</p>
                            {prescribed && (
                              <p className="text-muted-foreground">
                                {prescribed.dose} / {prescribed.frequency} / {prescribed.days}日分
                                {prescribed.quantity != null &&
                                  ` (${prescribed.quantity}${prescribed.unit ?? ''})`}
                              </p>
                            )}
                          </td>
                          {/* Dispensed */}
                          <td className="py-2">
                            <p
                              className={cn(
                                'font-medium',
                                hasDrugDiscrepancy && 'text-destructive'
                              )}
                            >
                              {result.actual_drug_name}
                            </p>
                            <p
                              className={cn(
                                'text-muted-foreground',
                                hasQtyDiscrepancy && 'text-destructive'
                              )}
                            >
                              {result.actual_quantity}
                              {result.actual_unit ?? ''} /{' '}
                              {CARRY_TYPE_LABEL[result.carry_type] ?? result.carry_type}
                            </p>
                            {result.discrepancy_reason && (
                              <p className="text-orange-600">
                                差異理由: {result.discrepancy_reason}
                              </p>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        {/* CDS alert panel */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">CDSアラート確認</CardTitle>
          </CardHeader>
          <CardContent>
            <CdsAlertPanel
              alerts={cdsData?.alerts ?? []}
              isLoading={cdsLoading}
            />
          </CardContent>
        </Card>

        {/* Checklist */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">確認チェックリスト</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3" role="list">
              {visibleItems.map((item) => {
                const isChecked = checked[item.id];
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => toggleCheck(item.id)}
                      className="flex w-full items-start gap-3 rounded-md p-2 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      aria-pressed={isChecked}
                    >
                      {isChecked ? (
                        <CheckSquare
                          className="mt-0.5 size-4 shrink-0 text-primary"
                          aria-hidden="true"
                        />
                      ) : (
                        <Square
                          className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                          aria-hidden="true"
                        />
                      )}
                      <span
                        className={cn(
                          'text-sm leading-snug',
                          isChecked && 'text-muted-foreground line-through'
                        )}
                      >
                        {item.label}
                        {item.required && (
                          <span className="ml-1 text-destructive" aria-label="必須">
                            *
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>

            {requiredUnchecked.length > 0 && (
              <p className="mt-3 text-xs text-muted-foreground" role="status">
                残り {requiredUnchecked.length} 件の必須項目が未確認です
              </p>
            )}
          </CardContent>
        </Card>

        {/* Action buttons */}
        <div className="flex justify-end gap-3 pb-6">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push(`/dispensing/${taskId}`)}
            disabled={submitMutation.isPending}
          >
            戻る
          </Button>
          <Button
            type="button"
            onClick={() => submitMutation.mutate()}
            disabled={isSubmitDisabled}
            aria-describedby={isSubmitDisabled ? 'checklist-hint' : undefined}
          >
            {submitMutation.isPending ? '登録中...' : '調剤完了'}
          </Button>
        </div>
        {isSubmitDisabled && requiredUnchecked.length > 0 && (
          <p id="checklist-hint" className="sr-only">
            全ての必須チェック項目を確認してから調剤完了ボタンを押してください
          </p>
        )}
      </div>
    </div>
  );
}
