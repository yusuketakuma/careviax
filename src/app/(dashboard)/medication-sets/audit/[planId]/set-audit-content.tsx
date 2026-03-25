'use client';

import { useState } from 'react';
import { CheckCircle2, XCircle, AlertTriangle, Info } from 'lucide-react';
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

type AuditSlot = {
  date: string;
  timeSlot: string;
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

const REJECT_REASON_OPTIONS: { value: RejectReasonCode; label: string }[] = [
  { value: 'drug_mismatch', label: '薬剤不一致' },
  { value: 'quantity_error', label: '数量誤り' },
  { value: 'patient_change', label: '患者状態変化' },
  { value: 'prescription_expired', label: '処方期限切れ' },
  { value: 'other', label: 'その他' },
];

// --- Sample data (placeholder) ---

const SAMPLE_SLOTS: AuditSlot[] = [
  { date: '2026-03-26', timeSlot: '朝', drugs: ['アムロジピン錠5mg 1錠', 'ロスバスタチン錠2.5mg 1錠'], approved: null },
  { date: '2026-03-26', timeSlot: '昼', drugs: ['メトホルミン錠250mg 1錠'], approved: null },
  { date: '2026-03-26', timeSlot: '夕', drugs: ['アムロジピン錠5mg 1錠'], approved: null },
  { date: '2026-03-26', timeSlot: '眠前', drugs: ['ゾルピデム酒石酸塩錠5mg 0.5錠'], approved: null },
  { date: '2026-03-27', timeSlot: '朝', drugs: ['アムロジピン錠5mg 1錠', 'ロスバスタチン錠2.5mg 1錠'], approved: null },
  { date: '2026-03-27', timeSlot: '昼', drugs: ['メトホルミン錠250mg 1錠'], approved: null },
  { date: '2026-03-27', timeSlot: '夕', drugs: ['アムロジピン錠5mg 1錠'], approved: null },
  { date: '2026-03-27', timeSlot: '眠前', drugs: ['ゾルピデム酒石酸塩錠5mg 0.5錠'], approved: null },
];

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
  const key = `${slot.date}-${slot.timeSlot}`;

  return (
    <tr className="border-b border-border hover:bg-muted/40">
      <td className="px-3 py-2">
        <Checkbox
          id={`select-${key}`}
          checked={selected}
          onCheckedChange={() => onToggleSelect(key)}
          aria-label={`${slot.date} ${slot.timeSlot}を選択`}
        />
      </td>
      <td className="px-3 py-2 text-sm text-muted-foreground">{slot.date}</td>
      <td className="px-3 py-2">
        <Badge variant="outline" className="text-xs">{slot.timeSlot}</Badge>
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
  const [slots, setSlots] = useState<AuditSlot[]>(SAMPLE_SLOTS);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectReasonCode, setRejectReasonCode] = useState<RejectReasonCode | ''>('');
  const [rejectNote, setRejectNote] = useState('');

  const allKeys = slots.map((s) => `${s.date}-${s.timeSlot}`);
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
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  function handleApproveSelected() {
    if (selected.size === 0) {
      toast.warning('承認するスロットを選択してください');
      return;
    }
    setSlots((prev) =>
      prev.map((s) => {
        const key = `${s.date}-${s.timeSlot}`;
        return selected.has(key) ? { ...s, approved: true } : s;
      })
    );
    setSelected(new Set());
    toast.success(`${selected.size}件を承認しました`);
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
    setSlots((prev) =>
      prev.map((s) => {
        const key = `${s.date}-${s.timeSlot}`;
        return selected.has(key) ? { ...s, approved: false } : s;
      })
    );
    setSelected(new Set());
    setRejectDialogOpen(false);
    setRejectReasonCode('');
    setRejectNote('');
    toast.success(`${selected.size}件を差戻しました`);
  }

  const pendingCount = slots.filter((s) => s.approved === null).length;
  const approvedCount = slots.filter((s) => s.approved === true).length;
  const rejectedCount = slots.filter((s) => s.approved === false).length;

  return (
    <div className="space-y-4">
      {/* Plan info */}
      <div className="flex items-start gap-3 rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <div>
          <p className="font-medium">セットプラン ID: {planId}</p>
          <p className="mt-0.5 text-blue-700">患者: 山田 太郎 / 対象期間: 2026-03-26 〜 2026-04-01</p>
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
          disabled={selected.size === 0}
          className="bg-green-700 text-white hover:bg-green-800"
        >
          <CheckCircle2 className="mr-1.5 size-3.5" aria-hidden="true" />
          選択を承認 ({selected.size})
        </Button>
        <Button
          size="sm"
          variant="destructive"
          onClick={openRejectDialog}
          disabled={selected.size === 0}
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
                  .map((s) => `${s.date}-${s.timeSlot}`)
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
                  <th className="px-3 py-2 text-left font-medium text-xs text-muted-foreground">日付</th>
                  <th className="px-3 py-2 text-left font-medium text-xs text-muted-foreground">時間帯</th>
                  <th className="px-3 py-2 text-left font-medium text-xs text-muted-foreground">薬剤</th>
                  <th className="px-3 py-2 text-left font-medium text-xs text-muted-foreground">状態</th>
                </tr>
              </thead>
              <tbody>
                {slots.map((slot) => {
                  const key = `${slot.date}-${slot.timeSlot}`;
                  return (
                    <SlotRow
                      key={key}
                      slot={slot}
                      selected={selected.has(key)}
                      onToggleSelect={toggleOne}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
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
