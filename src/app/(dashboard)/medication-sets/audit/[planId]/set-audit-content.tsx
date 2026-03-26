'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, XCircle, AlertTriangle, Info, Loader2 } from 'lucide-react';
import { useOrgId } from '@/lib/hooks/use-org-id';
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
import { Checkbox } from '@/components/ui/checkbox';

// --- Types ---

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

type AuditSlot = {
  key: string;
  dayNumber: number;
  slot: string;
  slotLabel: string;
  drugs: string[];
  approved: boolean | null;
};

type RejectReasonCode =
  | 'drug_mismatch'
  | 'quantity_error'
  | 'patient_change'
  | 'prescription_expired'
  | 'other';

// --- Constants ---

const SLOT_LABELS: Record<string, string> = {
  morning: '朝',
  noon: '昼',
  evening: '夕',
  bedtime: '眠前',
  prn: '頓用',
};

const REJECT_REASON_OPTIONS: { value: RejectReasonCode; label: string }[] = [
  { value: 'drug_mismatch', label: '薬剤不一致' },
  { value: 'quantity_error', label: '数量誤り' },
  { value: 'patient_change', label: '患者状態変化' },
  { value: 'prescription_expired', label: '処方期限切れ' },
  { value: 'other', label: 'その他' },
];

// --- Helpers ---

function batchesToAuditSlots(batches: SetBatch[]): AuditSlot[] {
  const slotMap = new Map<string, AuditSlot>();

  for (const batch of batches) {
    const key = `${batch.day_number}-${batch.slot}`;
    const drugLabel = `${batch.line.drug_name} ${batch.quantity}${batch.line.unit ?? ''}`;

    if (slotMap.has(key)) {
      slotMap.get(key)!.drugs.push(drugLabel);
    } else {
      slotMap.set(key, {
        key,
        dayNumber: batch.day_number,
        slot: batch.slot,
        slotLabel: SLOT_LABELS[batch.slot] ?? batch.slot,
        drugs: [drugLabel],
        approved: null,
      });
    }
  }

  return Array.from(slotMap.values()).sort((a, b) => {
    if (a.dayNumber !== b.dayNumber) return a.dayNumber - b.dayNumber;
    const slotOrder = ['morning', 'noon', 'evening', 'bedtime', 'prn'];
    return slotOrder.indexOf(a.slot) - slotOrder.indexOf(b.slot);
  });
}

// --- Components ---

function SlotRow({
  slot,
  selected,
  onToggleSelect,
}: {
  slot: AuditSlot;
  selected: boolean;
  onToggleSelect: (key: string) => void;
}) {
  return (
    <tr className="border-b border-border hover:bg-muted/40">
      <td className="px-3 py-2">
        <Checkbox
          id={`select-${slot.key}`}
          checked={selected}
          onCheckedChange={() => onToggleSelect(slot.key)}
          aria-label={`${slot.dayNumber}日目 ${slot.slotLabel}を選択`}
        />
      </td>
      <td className="px-3 py-2 text-sm text-muted-foreground">{slot.dayNumber}日目</td>
      <td className="px-3 py-2">
        <Badge variant="outline" className="text-xs">{slot.slotLabel}</Badge>
      </td>
      <td className="px-3 py-2">
        <ul className="space-y-0.5">
          {slot.drugs.map((d, i) => (
            <li key={i} className="text-sm">{d}</li>
          ))}
        </ul>
      </td>
      <td className="px-3 py-2">
        {slot.approved === true && (
          <span className="flex items-center gap-1 text-xs text-green-700">
            <CheckCircle2 className="size-3.5" aria-hidden="true" /> 承認済
          </span>
        )}
        {slot.approved === false && (
          <span className="flex items-center gap-1 text-xs text-red-700">
            <XCircle className="size-3.5" aria-hidden="true" /> 差戻し
          </span>
        )}
        {slot.approved === null && (
          <span className="text-xs text-muted-foreground">未鑑査</span>
        )}
      </td>
    </tr>
  );
}

// --- Main ---

export function SetAuditContent({ planId }: { planId: string }) {
  const queryClient = useQueryClient();
  const orgId = useOrgId();
  const [localApproval, setLocalApproval] = useState<Map<string, boolean | null>>(new Map());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectReasonCode, setRejectReasonCode] = useState<RejectReasonCode | ''>('');
  const [rejectNote, setRejectNote] = useState('');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['set-batches', planId],
    queryFn: async () => {
      const res = await fetch(`/api/set-batches?plan_id=${planId}`, {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('セットバッチの取得に失敗しました');
      const json = await res.json() as { data: SetBatch[] };
      return json.data;
    },
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
        const err = await res.json().catch(() => ({})) as { message?: string };
        throw new Error(err.message ?? '鑑査の保存に失敗しました');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['set-batches', planId] });
    },
  });

  const rawBatches = data ?? [];
  const baseSlots = batchesToAuditSlots(rawBatches);
  const slots = baseSlots.map((s) => ({
    ...s,
    approved: localApproval.has(s.key) ? (localApproval.get(s.key) ?? null) : s.approved,
  }));

  const allKeys = slots.map((s) => s.key);
  const allSelected = allKeys.length > 0 && allKeys.every((k) => selected.has(k));

  function toggleAll() {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(allKeys));
    }
  }

  function toggleOne(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function handleApproveSelected() {
    if (selected.size === 0) {
      toast.warning('承認するスロットを選択してください');
      return;
    }
    setLocalApproval((prev) => {
      const next = new Map(prev);
      for (const key of selected) next.set(key, true);
      return next;
    });

    const approvedKeys = Array.from(selected);
    const allApproved = slots.every(
      (s) => approvedKeys.includes(s.key) || s.approved === true
    );
    const result = allApproved ? 'approved' : 'partial_approved';
    const approvedScope = Object.fromEntries(approvedKeys.map((k) => [k, true]));

    auditMutation.mutate(
      { plan_id: planId, result, approved_scope: approvedScope },
      {
        onSuccess: () => toast.success(`${selected.size}件を承認しました`),
        onError: (err) => toast.error(err.message),
      }
    );

    setSelected(new Set());
  }

  function openRejectDialog() {
    if (selected.size === 0) {
      toast.warning('差戻すスロットを選択してください');
      return;
    }
    setRejectDialogOpen(true);
  }

  function handleReject() {
    if (!rejectReasonCode) {
      toast.error('差戻し理由を選択してください');
      return;
    }

    const rejectedKeys = Array.from(selected);
    setLocalApproval((prev) => {
      const next = new Map(prev);
      for (const key of rejectedKeys) next.set(key, false);
      return next;
    });

    const rejectLabel = REJECT_REASON_OPTIONS.find((o) => o.value === rejectReasonCode)?.label ?? rejectReasonCode;
    const rejectText = rejectNote ? `${rejectLabel}: ${rejectNote}` : rejectLabel;

    auditMutation.mutate(
      { plan_id: planId, result: 'rejected', reject_reason: rejectText },
      {
        onSuccess: () => toast.success(`${rejectedKeys.length}件を差戻しました`),
        onError: (err) => toast.error(err.message),
      }
    );

    setSelected(new Set());
    setRejectDialogOpen(false);
    setRejectReasonCode('');
    setRejectNote('');
  }

  const pendingCount = slots.filter((s) => s.approved === null).length;
  const approvedCount = slots.filter((s) => s.approved === true).length;
  const rejectedCount = slots.filter((s) => s.approved === false).length;

  if (isLoading) {
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
    <div className="space-y-4">
      {/* Plan info */}
      <div className="flex items-start gap-3 rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <div>
          <p className="font-medium">セットプラン ID: {planId}</p>
          <p className="mt-0.5 text-blue-700">
            {rawBatches.length > 0
              ? `${rawBatches.length}件のバッチが登録されています`
              : 'バッチが登録されていません'}
          </p>
        </div>
      </div>

      {/* Summary badges */}
      <div className="flex items-center gap-3">
        <span className="text-sm text-muted-foreground">未鑑査:</span>
        <Badge variant="outline">{pendingCount}件</Badge>
        <span className="text-sm text-muted-foreground">承認:</span>
        <Badge className="bg-green-100 text-green-800 hover:bg-green-100">{approvedCount}件</Badge>
        <span className="text-sm text-muted-foreground">差戻し:</span>
        <Badge className="bg-red-100 text-red-800 hover:bg-red-100">{rejectedCount}件</Badge>
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          onClick={handleApproveSelected}
          disabled={selected.size === 0 || auditMutation.isPending}
          className="bg-green-700 text-white hover:bg-green-800"
        >
          <CheckCircle2 className="mr-1.5 size-3.5" aria-hidden="true" />
          選択を承認 ({selected.size})
        </Button>
        <Button
          size="sm"
          variant="destructive"
          onClick={openRejectDialog}
          disabled={selected.size === 0 || auditMutation.isPending}
        >
          <XCircle className="mr-1.5 size-3.5" aria-hidden="true" />
          選択を差戻し ({selected.size})
        </Button>
        {pendingCount > 0 && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setSelected(new Set(
                slots
                  .filter((s) => s.approved === null)
                  .map((s) => s.key)
              ));
            }}
          >
            未鑑査を全選択
          </Button>
        )}
      </div>

      {/* Grid table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">スロット一覧</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {slots.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted-foreground">
              バッチが登録されていません。セット計画編集から自動生成してください。
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm" role="grid" aria-label="鑑査スロット一覧">
                <thead>
                  <tr className="border-b border-border bg-muted">
                    <th className="px-3 py-2 text-left">
                      <Checkbox
                        checked={allSelected}
                        onCheckedChange={toggleAll}
                        aria-label="全選択"
                      />
                    </th>
                    <th className="px-3 py-2 text-left font-medium text-xs text-muted-foreground">日数</th>
                    <th className="px-3 py-2 text-left font-medium text-xs text-muted-foreground">時間帯</th>
                    <th className="px-3 py-2 text-left font-medium text-xs text-muted-foreground">薬剤</th>
                    <th className="px-3 py-2 text-left font-medium text-xs text-muted-foreground">状態</th>
                  </tr>
                </thead>
                <tbody>
                  {slots.map((slot) => (
                    <SlotRow
                      key={slot.key}
                      slot={slot}
                      selected={selected.has(slot.key)}
                      onToggleSelect={toggleOne}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Reject dialog */}
      <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>差戻し理由の入力</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="flex items-start gap-2 rounded-md border border-orange-200 bg-orange-50 px-3 py-2 text-xs text-orange-800">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              {selected.size}件のスロットを差戻します。差戻し後は再計画が必要です。
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reject-reason">差戻し理由コード</Label>
              <Select
                value={rejectReasonCode}
                onValueChange={(v) => setRejectReasonCode((v ?? '') as RejectReasonCode | '')}
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
            <Button size="sm" variant="destructive" onClick={handleReject}>
              差戻し実行
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
