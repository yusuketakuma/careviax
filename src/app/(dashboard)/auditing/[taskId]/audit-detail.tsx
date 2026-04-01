'use client';

import { useCallback, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  CheckCircle2,
  XCircle,
  PauseCircle,
  Package,
  History,
  AlertTriangle,
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { ja } from 'date-fns/locale';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { PreviousStageSummary } from '@/components/features/workflow/previous-stage-summary';
import { StageTimeline } from '@/components/features/workflow/stage-timeline';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Loading } from '@/components/ui/loading';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { CdsAlertPanel, type CdsAlert } from '@/components/features/cds/alert-panel';
import {
  useKeyboardShortcuts,
  type ShortcutDefinition,
} from '@/components/features/keyboard/use-keyboard-shortcuts';
import type { PackagingGroupAssignment } from '@/lib/dispensing/packaging-group';

// ── Types ──

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
  is_generic: boolean;
  packaging_instructions: string | null;
  notes: string | null;
};

type DispenseResultItem = {
  id: string;
  line_id: string;
  actual_drug_name: string;
  actual_drug_code: string | null;
  actual_quantity: number;
  actual_unit: string | null;
  discrepancy_reason: string | null;
  carry_type: string;
  special_notes: string | null;
  dispensed_at: string;
  line: PrescriptionLine;
};

type AuditTaskDetail = {
  id: string;
  priority: string;
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
      original_document_url: string | null;
      lines: PrescriptionLine[];
    }>;
  };
  results: DispenseResultItem[];
  prefill: {
    packagingGroups: PackagingGroupAssignment[];
    isPrefillAvailable: boolean;
  } | null;
};

// ── Constants ──

const CHECKLIST_ITEMS = [
  { id: 'patient_match', label: '患者一致' },
  { id: 'drug_name_spec', label: '薬剤名・規格' },
  { id: 'dose_days', label: '用量・日数' },
  { id: 'packaging', label: '包装指示' },
  { id: 'high_risk', label: '高リスク薬確認' },
  { id: 'carry_type', label: '持参区分確認' },
];

const REJECT_REASON_OPTIONS = [
  { value: 'wrong_drug', label: '薬剤間違い' },
  { value: 'wrong_quantity', label: '数量間違い' },
  { value: 'wrong_patient', label: '患者間違い' },
  { value: 'packaging_error', label: '包装指示違反' },
  { value: 'high_risk_unchecked', label: '高リスク薬未確認' },
  { value: 'other', label: 'その他' },
];

const carryTypeLabel: Record<string, string> = {
  carry: '持参',
  facility_deposit: '施設預け',
  deferred: '後日対応',
};

const priorityVariant: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  emergency: 'destructive',
  urgent: 'secondary',
  normal: 'outline',
};

const priorityLabel: Record<string, string> = {
  emergency: '緊急',
  urgent: '至急',
  normal: '通常',
};

// ── Helpers ──

/**
 * Group DispenseResultItems by packaging_group_id (via line_id → packagingGroups lookup).
 * Falls back to flat list when no packagingGroups are available.
 */
function groupResultsByPackaging(
  results: DispenseResultItem[],
  packagingGroups: PackagingGroupAssignment[],
): Array<{
  groupId: string | null;
  groupLabel: string;
  items: DispenseResultItem[];
}> {
  if (packagingGroups.length === 0) {
    return [{ groupId: null, groupLabel: '調剤品目', items: results }];
  }

  const groupMap = new Map<string, PackagingGroupAssignment>();
  for (const pg of packagingGroups) {
    groupMap.set(pg.lineId, pg);
  }

  const buckets = new Map<
    string,
    { groupId: string | null; groupLabel: string; items: DispenseResultItem[] }
  >();

  for (const result of results) {
    const pg = groupMap.get(result.line_id);
    const key = pg?.groupId ?? '__ungrouped__';
    const label = pg?.groupLabel ?? '個別包装';

    if (!buckets.has(key)) {
      buckets.set(key, { groupId: pg?.groupId ?? null, groupLabel: label, items: [] });
    }
    buckets.get(key)!.items.push(result);
  }

  // Order: named groups first (sorted by label), then ungrouped
  const entries = Array.from(buckets.entries());
  const grouped = entries
    .filter(([key]) => key !== '__ungrouped__')
    .sort((a, b) => a[1].groupLabel.localeCompare(b[1].groupLabel, 'ja'));
  const ungrouped = entries.filter(([key]) => key === '__ungrouped__');

  return [...grouped, ...ungrouped].map(([, val]) => val);
}

// ── Sub-components ──

function GroupCard({
  groupLabel,
  groupId,
  items,
}: {
  groupLabel: string;
  groupId: string | null;
  items: DispenseResultItem[];
}) {
  const isUngrouped = groupId === null;

  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-b bg-muted/30 py-2.5 px-4">
        <div className="flex items-center gap-2">
          <Package className="size-3.5 text-muted-foreground" aria-hidden="true" />
          <CardTitle className="text-sm font-semibold">{groupLabel}</CardTitle>
          {!isUngrouped && (
            <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-100 text-xs">
              一包化
            </Badge>
          )}
          {isUngrouped && (
            <Badge variant="secondary" className="text-xs">
              個別包装
            </Badge>
          )}
          <span className="ml-auto text-xs text-muted-foreground">{items.length}品目</span>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <table className="min-w-full text-sm" aria-label={`${groupLabel}の調剤品目`}>
          <thead>
            <tr className="border-b bg-muted/10">
              <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">薬剤名</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">数量</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">持参区分</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">調剤時刻</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {items.map((result) => {
              const hasDiscrepancy = result.actual_drug_name !== result.line.drug_name;
              const isPkg = groupMap_isCrushed(result);

              return (
                <tr
                  key={result.id}
                  className={hasDiscrepancy ? 'border-l-2 border-l-amber-400' : undefined}
                >
                  <td className="px-4 py-3">
                    <div className="space-y-0.5">
                      <p className="font-medium leading-snug">{result.actual_drug_name}</p>
                      {hasDiscrepancy && (
                        <p className="text-xs text-amber-700">
                          処方: {result.line.drug_name}
                        </p>
                      )}
                      {isPkg && (
                        <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100 text-xs">
                          粉砕
                        </Badge>
                      )}
                      {result.discrepancy_reason && (
                        <p className="text-xs text-muted-foreground">
                          理由: {result.discrepancy_reason}
                        </p>
                      )}
                      {result.special_notes && (
                        <p className="text-xs text-muted-foreground">
                          備考: {result.special_notes}
                        </p>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 tabular-nums text-sm">
                    {result.actual_quantity}
                    {result.actual_unit ?? ''}
                  </td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">
                    {carryTypeLabel[result.carry_type] ?? result.carry_type}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {format(parseISO(result.dispensed_at), 'MM/dd HH:mm', { locale: ja })}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

// Placeholder: crushing detection via packaging_instructions text (since is_crushed is not on result)
function groupMap_isCrushed(result: DispenseResultItem): boolean {
  return (
    result.line.packaging_instructions?.includes('粉砕') === true ||
    result.special_notes?.includes('粉砕') === true
  );
}

// ── Main component ──

type AuditDetailProps = {
  taskId: string;
};

type AuditPane = 'groups' | 'checklist';

const AUDIT_PANES: AuditPane[] = ['groups', 'checklist'];

export function AuditDetail({ taskId }: AuditDetailProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const orgId = useOrgId();
  const isBootstrappingOrg = !orgId;
  const actionParam = searchParams.get('action');

  const [historyOpen, setHistoryOpen] = useState(false);
  const [checklist, setChecklist] = useState<Record<string, boolean>>(
    Object.fromEntries(CHECKLIST_ITEMS.map((item) => [item.id, false]))
  );
  const [formState, setFormState] = useState(() => ({
    rejectReason: '',
    rejectDetail: '',
    showReject: actionParam === 'reject',
    showEmergency: false,
    emergencyReason: '',
  }));
  const [activePane, setActivePane] = useState<AuditPane>(() =>
    actionParam === 'approve' || actionParam === 'reject' ? 'checklist' : 'groups'
  );
  const [activeChecklistIndex, setActiveChecklistIndex] = useState(0);

  // Fetch via /api/dispense-tasks/[taskId] to get prefill.packagingGroups + results
  const { data: task, isLoading } = useQuery({
    queryKey: ['dispense-task-detail', taskId, orgId],
    queryFn: async () => {
      const res = await fetch(`/api/dispense-tasks/${taskId}`, {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('調剤タスクの取得に失敗しました');
      return res.json() as Promise<AuditTaskDetail>;
    },
    enabled: !!orgId && !!taskId,
  });

  const cycleId = task?.cycle.id ?? '';
  const patientId = task?.cycle.patient_id ?? '';

  const { data: cdsData, isLoading: cdsLoading } = useQuery({
    queryKey: ['cds-alerts', cycleId, patientId, orgId],
    queryFn: async () => {
      const res = await fetch('/api/cds/check', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-org-id': orgId,
        },
        body: JSON.stringify({ cycleId, patientId }),
      });
      if (!res.ok) return { alerts: [] as CdsAlert[] };
      return res.json() as Promise<{ alerts: CdsAlert[] }>;
    },
    enabled: !!orgId && !!cycleId && !!patientId,
  });

  const mutation = useMutation({
    mutationFn: async (payload: {
      result: 'approved' | 'rejected' | 'hold' | 'emergency_approved';
      reject_reason?: string;
      reject_detail?: string;
    }) => {
      const res = await fetch('/api/dispense-audits', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-org-id': orgId,
        },
        body: JSON.stringify({ task_id: taskId, ...payload }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(
          (err as { message?: string }).message ?? '鑑査の登録に失敗しました'
        );
      }
      return res.json();
    },
    onSuccess: (_, variables) => {
      const label =
        variables.result === 'approved' || variables.result === 'emergency_approved'
          ? '承認しました'
          : variables.result === 'rejected'
          ? '差戻しました'
          : '保留にしました';
      toast.success('鑑査完了', { description: label });
      router.push('/auditing');
    },
    onError: (err: Error) => {
      toast.error('エラー', { description: err.message });
    },
  });

  const allChecked = Object.values(checklist).every(Boolean);

  const handleApprove = useCallback(() => {
    if (!allChecked) {
      toast.warning('チェックリストを全て確認してください');
      return;
    }
    mutation.mutate({ result: 'approved' });
  }, [allChecked, mutation]);

  const handleHold = useCallback(() => {
    mutation.mutate({ result: 'hold' });
  }, [mutation]);

  const handleReject = useCallback(() => {
    if (!formState.rejectReason) {
      toast.warning('差戻し理由を選択してください');
      return;
    }
    mutation.mutate({
      result: 'rejected',
      reject_reason: formState.rejectReason,
      reject_detail: formState.rejectDetail || undefined,
    });
  }, [mutation, formState.rejectDetail, formState.rejectReason]);

  const handleEmergencyApprove = useCallback(() => {
    if (!allChecked) {
      toast.warning('チェックリストを全て確認してください');
      return;
    }
    if (!formState.emergencyReason.trim()) {
      toast.warning('緊急例外承認の理由を入力してください');
      return;
    }
    mutation.mutate({
      result: 'emergency_approved',
      reject_detail: formState.emergencyReason.trim(),
    });
  }, [allChecked, formState.emergencyReason, mutation]);

  const handleNextPane = useCallback((direction: 1 | -1) => {
    setActivePane((current) => {
      const currentIndex = AUDIT_PANES.indexOf(current);
      const nextIndex = (currentIndex + direction + AUDIT_PANES.length) % AUDIT_PANES.length;
      return AUDIT_PANES[nextIndex] ?? 'groups';
    });
  }, []);

  const handleToggleChecklistItem = useCallback(() => {
    if (activePane !== 'checklist') {
      setActivePane('checklist');
      return;
    }

    const item = CHECKLIST_ITEMS[activeChecklistIndex];
    if (!item) return;

    setChecklist((prev) => ({ ...prev, [item.id]: !prev[item.id] }));
  }, [activeChecklistIndex, activePane]);

  const shortcuts: ShortcutDefinition[] = useMemo(
    () => [
      {
        key: 'Tab',
        handler: () => handleNextPane(1),
        description: 'ペイン切替',
        scope: 'auditing',
      },
      {
        key: 'Tab',
        shiftKey: true,
        handler: () => handleNextPane(-1),
        description: '前のペインへ切替',
        scope: 'auditing',
      },
      { key: 'a', handler: handleApprove, description: '承認', scope: 'auditing' },
      {
        key: 'r',
        handler: () => {
          if (!formState.showReject) {
            setFormState((prev) => ({ ...prev, showReject: true }));
            setActivePane('checklist');
            return;
          }
          handleReject();
        },
        description: '差戻し',
        scope: 'auditing',
      },
      {
        key: ' ',
        handler: handleToggleChecklistItem,
        description: 'チェック項目トグル',
        scope: 'auditing',
      },
    ],
    [handleApprove, handleNextPane, handleReject, handleToggleChecklistItem, formState.showReject]
  );

  useKeyboardShortcuts(shortcuts);

  if (isBootstrappingOrg || isLoading) return <Loading />;
  if (!task) {
    return <p className="text-sm text-muted-foreground">鑑査タスクが見つかりません</p>;
  }

  const intake = task.cycle.prescription_intakes[0];
  const patient = task.cycle.case_.patient;
  const alerts = cdsData?.alerts ?? [];
  const packagingGroups = task.prefill?.packagingGroups ?? [];
  const groups = groupResultsByPackaging(task.results, packagingGroups);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold">{patient.name} 様</h2>
        <Badge variant={priorityVariant[task.priority] ?? 'outline'}>
          {priorityLabel[task.priority] ?? task.priority}
        </Badge>
        {intake && (
          <span className="text-sm text-muted-foreground">
            処方日:{' '}
            {format(parseISO(intake.prescribed_date), 'yyyy/MM/dd', { locale: ja })}
            {intake.prescriber_name && ` / ${intake.prescriber_name}`}
            {intake.prescriber_institution && ` (${intake.prescriber_institution})`}
          </span>
        )}
      </div>

      {/* Previous stage + history */}
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <PreviousStageSummary cycleId={cycleId} />
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
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
            <StageTimeline cycleId={cycleId} />
          </div>
        </SheetContent>
      </Sheet>

      {/* CDS alerts */}
      <CdsAlertPanel alerts={alerts} isLoading={cdsLoading} />

      {/* Empty results fallback */}
      {task.results.length === 0 && (
        <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p>調剤実績が登録されていません。</p>
        </div>
      )}

      {/* Group-based card view */}
      {task.results.length > 0 && (
        <section
          aria-label="調剤グループ一覧"
          className={
            activePane === 'groups'
              ? 'space-y-4 rounded-md ring-2 ring-primary/30 p-1'
              : 'space-y-4'
          }
        >
          <h3 className="text-sm font-semibold text-muted-foreground px-1">
            調剤グループ ({groups.length}グループ / {task.results.length}品目)
          </h3>
          {groups.map((group) => (
            <GroupCard
              key={group.groupId ?? '__ungrouped__'}
              groupLabel={group.groupLabel}
              groupId={group.groupId}
              items={group.items}
            />
          ))}
        </section>
      )}

      {/* Checklist */}
      <Card
        className={activePane === 'checklist' ? 'ring-2 ring-primary/50' : undefined}
      >
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">鑑査チェックリスト</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-3">
            {CHECKLIST_ITEMS.map((item, index) => (
              <li
                key={item.id}
                className={
                  activePane === 'checklist' && activeChecklistIndex === index
                    ? 'flex items-center gap-3 rounded-md bg-primary/5 px-2 py-1'
                    : 'flex items-center gap-3 rounded-md px-2 py-1'
                }
              >
                <Checkbox
                  id={`checklist-${item.id}`}
                  checked={checklist[item.id]}
                  onCheckedChange={(checked) =>
                    setChecklist((prev) => ({ ...prev, [item.id]: checked === true }))
                  }
                  onFocus={() => {
                    setActivePane('checklist');
                    setActiveChecklistIndex(index);
                  }}
                  aria-label={item.label}
                />
                <label
                  htmlFor={`checklist-${item.id}`}
                  className="cursor-pointer select-none text-sm"
                  onMouseEnter={() => {
                    setActivePane('checklist');
                    setActiveChecklistIndex(index);
                  }}
                >
                  {item.label}
                </label>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {/* Reject form */}
      {formState.showReject && (
        <Card className="border-destructive/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-destructive">差戻し理由</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="reject-reason" className="text-xs">
                理由コード <span className="text-destructive">*</span>
              </Label>
              <Select
                value={formState.rejectReason}
                onValueChange={(v) =>
                  setFormState((prev) => ({ ...prev, rejectReason: v ?? '' }))
                }
              >
                <SelectTrigger id="reject-reason" className="h-8 text-sm">
                  <SelectValue placeholder="理由を選択してください" />
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
            <div className="space-y-1">
              <Label htmlFor="reject-detail" className="text-xs">
                補足テキスト
              </Label>
              <Textarea
                id="reject-detail"
                value={formState.rejectDetail}
                onChange={(e) =>
                  setFormState((prev) => ({ ...prev, rejectDetail: e.target.value }))
                }
                className="min-h-[80px] text-sm"
                placeholder="具体的な差戻し内容を入力してください"
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Emergency approval form */}
      {formState.showEmergency && (
        <Card className="border-amber-400/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-amber-700">緊急例外承認</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="emergency-approval-reason" className="text-xs">
                承認理由 <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="emergency-approval-reason"
                value={formState.emergencyReason}
                onChange={(e) =>
                  setFormState((prev) => ({ ...prev, emergencyReason: e.target.value }))
                }
                className="min-h-[80px] text-sm"
                placeholder="例外承認が必要な理由を入力してください"
              />
            </div>
          </CardContent>
        </Card>
      )}

      <Separator />

      {/* Action buttons */}
      <div className="flex flex-wrap items-center justify-end gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={() => router.push('/auditing')}
          disabled={mutation.isPending}
        >
          キャンセル
        </Button>

        <Button
          type="button"
          variant="outline"
          className="border-orange-400 text-orange-600 hover:bg-orange-50"
          onClick={handleHold}
          disabled={mutation.isPending}
        >
          <PauseCircle className="mr-1.5 size-4" aria-hidden="true" />
          保留
        </Button>

        {!formState.showReject ? (
          <Button
            type="button"
            variant="destructive"
            onClick={() =>
              setFormState((prev) => ({ ...prev, showEmergency: false, showReject: true }))
            }
            disabled={mutation.isPending}
          >
            <XCircle className="mr-1.5 size-4" aria-hidden="true" />
            差戻し
          </Button>
        ) : (
          <Button
            type="button"
            variant="destructive"
            onClick={handleReject}
            disabled={mutation.isPending}
          >
            {mutation.isPending ? '処理中...' : '差戻し確定'}
          </Button>
        )}

        <Button
          type="button"
          onClick={handleApprove}
          disabled={mutation.isPending || !allChecked}
          title={!allChecked ? 'チェックリストを全て確認してください' : undefined}
        >
          <CheckCircle2 className="mr-1.5 size-4" aria-hidden="true" />
          {mutation.isPending ? '処理中...' : '承認'}
        </Button>

        {!formState.showEmergency ? (
          <Button
            type="button"
            variant="outline"
            className="border-amber-400 text-amber-700 hover:bg-amber-50"
            onClick={() =>
              setFormState((prev) => ({ ...prev, showReject: false, showEmergency: true }))
            }
            disabled={mutation.isPending}
          >
            緊急例外承認
          </Button>
        ) : (
          <Button
            type="button"
            variant="outline"
            className="border-amber-400 text-amber-700 hover:bg-amber-50"
            onClick={handleEmergencyApprove}
            disabled={mutation.isPending}
          >
            {mutation.isPending ? '処理中...' : '例外承認を確定'}
          </Button>
        )}
      </div>
    </div>
  );
}
