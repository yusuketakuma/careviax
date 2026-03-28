'use client';

import { useCallback, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CheckCircle2, XCircle, PauseCircle, FileText, ClipboardList, Package } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { ja } from 'date-fns/locale';
import { useOrgId } from '@/lib/hooks/use-org-id';
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
import { CdsAlertPanel, type CdsAlert } from '@/components/features/cds/alert-panel';
import { useKeyboardShortcuts, type ShortcutDefinition } from '@/components/features/keyboard/use-keyboard-shortcuts';

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
  actual_drug_name: string;
  actual_quantity: number;
  actual_unit: string | null;
  carry_type: string;
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
};

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

type AuditDetailProps = {
  taskId: string;
};

type AuditPane = 'original' | 'structured' | 'results' | 'checklist';

const AUDIT_PANES: AuditPane[] = ['original', 'structured', 'results', 'checklist'];

export function AuditDetail({ taskId }: AuditDetailProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const orgId = useOrgId();
  const actionParam = searchParams.get('action');

  const [checklist, setChecklist] = useState<Record<string, boolean>>(
    Object.fromEntries(CHECKLIST_ITEMS.map((item) => [item.id, false]))
  );
  const [rejectReason, setRejectReason] = useState('');
  const [rejectDetail, setRejectDetail] = useState('');
  const [showRejectForm, setShowRejectForm] = useState(() => actionParam === 'reject');
  const [showEmergencyApprovalForm, setShowEmergencyApprovalForm] = useState(false);
  const [emergencyApprovalReason, setEmergencyApprovalReason] = useState('');
  const [activePane, setActivePane] = useState<AuditPane>(() =>
    actionParam === 'approve' || actionParam === 'reject' ? 'checklist' : 'original'
  );
  const [activeChecklistIndex, setActiveChecklistIndex] = useState(0);

  const { data: task, isLoading } = useQuery({
    queryKey: ['audit-task-detail', taskId, orgId],
    queryFn: async () => {
      const res = await fetch('/api/dispense-audits', {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('鑑査タスクの取得に失敗しました');
      const json = (await res.json()) as { data: AuditTaskDetail[] };
      const found = json.data.find((t) => t.id === taskId);
      if (!found) throw new Error('鑑査タスクが見つかりません');
      return found;
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
    if (!rejectReason) {
      toast.warning('差戻し理由を選択してください');
      return;
    }
    mutation.mutate({
      result: 'rejected',
      reject_reason: rejectReason,
      reject_detail: rejectDetail || undefined,
    });
  }, [mutation, rejectDetail, rejectReason]);

  const handleEmergencyApprove = useCallback(() => {
    if (!allChecked) {
      toast.warning('チェックリストを全て確認してください');
      return;
    }
    if (!emergencyApprovalReason.trim()) {
      toast.warning('緊急例外承認の理由を入力してください');
      return;
    }
    mutation.mutate({
      result: 'emergency_approved',
      reject_detail: emergencyApprovalReason.trim(),
    });
  }, [allChecked, emergencyApprovalReason, mutation]);

  const handleNextPane = useCallback((direction: 1 | -1) => {
    setActivePane((current) => {
      const currentIndex = AUDIT_PANES.indexOf(current);
      const nextIndex = (currentIndex + direction + AUDIT_PANES.length) % AUDIT_PANES.length;
      return AUDIT_PANES[nextIndex] ?? 'original';
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
      { key: 'Tab', handler: () => handleNextPane(1), description: 'ペイン切替', scope: 'auditing' },
      { key: 'Tab', shiftKey: true, handler: () => handleNextPane(-1), description: '前のペインへ切替', scope: 'auditing' },
      { key: 'a', handler: handleApprove, description: '承認', scope: 'auditing' },
      {
        key: 'r',
        handler: () => {
          if (!showRejectForm) {
            setShowRejectForm(true);
            setActivePane('checklist');
            return;
          }
          handleReject();
        },
        description: '差戻し',
        scope: 'auditing',
      },
      { key: ' ', handler: handleToggleChecklistItem, description: 'チェック項目トグル', scope: 'auditing' },
    ],
    [handleApprove, handleNextPane, handleReject, handleToggleChecklistItem, showRejectForm],
  );

  useKeyboardShortcuts(shortcuts);

  if (isLoading) return <Loading />;
  if (!task) {
    return <p className="text-sm text-muted-foreground">鑑査タスクが見つかりません</p>;
  }

  const intake = task.cycle.prescription_intakes[0];
  const patient = task.cycle.case_.patient;
  const alerts = cdsData?.alerts ?? [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold">
          {patient.name} 様
        </h2>
        <Badge variant={priorityVariant[task.priority] ?? 'outline'}>
          {priorityLabel[task.priority] ?? task.priority}
        </Badge>
        {intake && (
          <span className="text-sm text-muted-foreground">
            処方日: {format(parseISO(intake.prescribed_date), 'yyyy/MM/dd', { locale: ja })}
            {intake.prescriber_name && ` / ${intake.prescriber_name}`}
          </span>
        )}
      </div>

      {/* CDS Alert Panel */}
      <CdsAlertPanel alerts={alerts} isLoading={cdsLoading} />

      {/* 3-pane comparison view */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:items-start">
        {/* Left: Original prescription */}
        <Card className={activePane === 'original' ? 'ring-2 ring-primary/50 lg:col-span-1' : 'lg:col-span-1'}>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <FileText className="size-4" aria-hidden="true" />
              処方原本
            </CardTitle>
          </CardHeader>
          <CardContent>
            {intake?.original_document_url ? (
              <div className="overflow-hidden rounded-md border">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={intake.original_document_url}
                  alt="処方箋原本"
                  className="w-full object-contain"
                />
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                原本画像なし（電子処方箋またはデータ入力）
              </p>
            )}
          </CardContent>
        </Card>

        {/* Center: Structured prescription lines */}
        <Card className={activePane === 'structured' ? 'ring-2 ring-primary/50 lg:col-span-1' : 'lg:col-span-1'}>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <ClipboardList className="size-4" aria-hidden="true" />
              構造化明細
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {intake?.lines.map((line) => (
              <div key={line.id} className="rounded-md border p-2.5 text-xs">
                <p className="font-medium text-sm">{line.drug_name}</p>
                {line.dosage_form && (
                  <p className="text-muted-foreground">{line.dosage_form}</p>
                )}
                <dl className="mt-1 grid grid-cols-2 gap-x-2 gap-y-0.5 text-muted-foreground">
                  <div>
                    <dt className="inline font-medium">用量: </dt>
                    <dd className="inline">{line.dose}</dd>
                  </div>
                  <div>
                    <dt className="inline font-medium">用法: </dt>
                    <dd className="inline">{line.frequency}</dd>
                  </div>
                  <div>
                    <dt className="inline font-medium">日数: </dt>
                    <dd className="inline">{line.days}日</dd>
                  </div>
                  {line.quantity != null && (
                    <div>
                      <dt className="inline font-medium">数量: </dt>
                      <dd className="inline">
                        {line.quantity}
                        {line.unit ?? ''}
                      </dd>
                    </div>
                  )}
                </dl>
                {line.packaging_instructions && (
                  <p className="mt-1 text-orange-600">
                    包装指示: {line.packaging_instructions}
                  </p>
                )}
                {line.is_generic && (
                  <Badge variant="secondary" className="mt-1 text-xs">
                    後発品可
                  </Badge>
                )}
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Right: Dispense results */}
        <Card className={activePane === 'results' ? 'ring-2 ring-primary/50 lg:col-span-1' : 'lg:col-span-1'}>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Package className="size-4" aria-hidden="true" />
              調剤実績
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {task.results.map((result) => (
              <div key={result.id} className="rounded-md border p-2.5 text-xs">
                <p className="font-medium text-sm">{result.actual_drug_name}</p>
                <dl className="mt-1 grid grid-cols-2 gap-x-2 gap-y-0.5 text-muted-foreground">
                  <div>
                    <dt className="inline font-medium">数量: </dt>
                    <dd className="inline">
                      {result.actual_quantity}
                      {result.actual_unit ?? ''}
                    </dd>
                  </div>
                  <div>
                    <dt className="inline font-medium">持参区分: </dt>
                    <dd className="inline">
                      {carryTypeLabel[result.carry_type] ?? result.carry_type}
                    </dd>
                  </div>
                </dl>
                <p className="mt-1 text-muted-foreground">
                  調剤: {format(parseISO(result.dispensed_at), 'MM/dd HH:mm', { locale: ja })}
                </p>
                {/* Highlight discrepancy */}
                {result.actual_drug_name !== result.line.drug_name && (
                  <p className="mt-1 text-orange-600 text-xs">
                    処方: {result.line.drug_name}（後発品変更）
                  </p>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Checklist */}
      <Card className={activePane === 'checklist' ? 'ring-2 ring-primary/50' : undefined}>
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

      {/* Reject form (shown when user clicks 差戻し) */}
      {showRejectForm && (
        <Card className="border-destructive/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-destructive">差戻し理由</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="reject-reason" className="text-xs">
                理由コード <span className="text-destructive">*</span>
              </Label>
              <Select value={rejectReason} onValueChange={(v) => setRejectReason(v ?? '')}>
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
                value={rejectDetail}
                onChange={(e) => setRejectDetail(e.target.value)}
                className="min-h-[80px] text-sm"
                placeholder="具体的な差戻し内容を入力してください"
              />
            </div>
          </CardContent>
        </Card>
      )}

      {showEmergencyApprovalForm && (
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
                value={emergencyApprovalReason}
                onChange={(e) => setEmergencyApprovalReason(e.target.value)}
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

        {!showRejectForm ? (
          <Button
            type="button"
            variant="destructive"
            onClick={() => {
              setShowEmergencyApprovalForm(false);
              setShowRejectForm(true);
            }}
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

        {!showEmergencyApprovalForm ? (
          <Button
            type="button"
            variant="outline"
            className="border-amber-400 text-amber-700 hover:bg-amber-50"
            onClick={() => {
              setShowRejectForm(false);
              setShowEmergencyApprovalForm(true);
            }}
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
