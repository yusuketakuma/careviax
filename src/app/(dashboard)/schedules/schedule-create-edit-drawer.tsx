'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  CONTACT_STATUS_LABELS,
  PRIORITY_LABELS,
  VISIT_TYPE_LABELS,
  type CaseOption,
  type PatientContactStatus,
  type Pharmacist,
  type Proposal,
  type VisitPriority,
  type VisitType,
} from './day-view.shared';

type TravelMode = 'DRIVE' | 'BICYCLE' | 'WALK' | 'TWO_WHEELER';

const TRAVEL_MODE_LABELS: Record<TravelMode, string> = {
  DRIVE: '社用車',
  BICYCLE: '自転車',
  WALK: '徒歩',
  TWO_WHEELER: 'バイク',
};

const VISIT_TYPE_OPTIONS = Object.entries(VISIT_TYPE_LABELS) as Array<[VisitType, string]>;
const PRIORITY_OPTIONS = Object.entries(PRIORITY_LABELS) as Array<[VisitPriority, string]>;
const CONTACT_STATUS_OPTIONS = Object.entries(CONTACT_STATUS_LABELS) as Array<
  [PatientContactStatus, string]
>;
const DRAFT_CONTACT_STATUS_OPTIONS = CONTACT_STATUS_OPTIONS.filter(
  ([value]) => value !== 'confirmed',
);
const TRAVEL_MODE_OPTIONS = Object.entries(TRAVEL_MODE_LABELS) as Array<[TravelMode, string]>;

export type ScheduleCreateEditDrawerForm = {
  case_id: string;
  visit_type: VisitType;
  priority: VisitPriority;
  proposed_date: string;
  time_window_start: string;
  proposed_pharmacist_id: string;
  travel_mode: TravelMode;
  patient_contact_status: PatientContactStatus;
};

export function buildScheduleCreateEditDrawerForm(args: {
  defaultDate: string;
  proposal?: Proposal | null;
  cases: CaseOption[];
  pharmacists: Pharmacist[];
}): ScheduleCreateEditDrawerForm {
  const { defaultDate, proposal, cases, pharmacists } = args;
  if (proposal) {
    return {
      case_id: proposal.case_id,
      visit_type: proposal.visit_type,
      priority: proposal.priority,
      proposed_date: proposal.proposed_date.slice(0, 10),
      time_window_start: proposal.time_window_start?.slice(0, 5) ?? '',
      proposed_pharmacist_id: proposal.proposed_pharmacist_id,
      travel_mode: (proposal.vehicle_resource?.travel_mode as TravelMode | undefined) ?? 'DRIVE',
      patient_contact_status: proposal.patient_contact_status,
    };
  }
  const firstCase = cases[0];
  const defaultPharmacistId = firstCase?.primary_pharmacist_id ?? pharmacists[0]?.id ?? '';
  return {
    case_id: firstCase?.id ?? '',
    visit_type: 'regular',
    priority: 'normal',
    proposed_date: defaultDate,
    time_window_start: '',
    proposed_pharmacist_id: defaultPharmacistId,
    travel_mode: 'DRIVE',
    patient_contact_status: 'pending',
  };
}

export function isScheduleCreateEditDrawerFormValid(form: ScheduleCreateEditDrawerForm): boolean {
  return Boolean(form.case_id && form.proposed_date && form.proposed_pharmacist_id);
}

export function buildScheduleCreateEditDrawerPayload(args: {
  form: ScheduleCreateEditDrawerForm;
  proposalId?: string;
  submitForContact: boolean;
}) {
  const { form, proposalId, submitForContact } = args;
  return {
    ...(proposalId ? { id: proposalId } : {}),
    case_id: form.case_id,
    visit_type: form.visit_type,
    priority: form.priority,
    proposed_date: form.proposed_date,
    ...(form.time_window_start ? { time_window_start: form.time_window_start } : {}),
    proposed_pharmacist_id: form.proposed_pharmacist_id,
    travel_mode: form.travel_mode,
    patient_contact_status: form.patient_contact_status,
    submit_for_contact: submitForContact,
  };
}

type ScheduleCreateEditDrawerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgId: string;
  cases: CaseOption[];
  pharmacists: Pharmacist[];
  defaultDate: string;
  /** 編集対象。未指定なら新規作成 */
  editingProposal?: Proposal | null;
  onSaved?: () => void;
};

export function ScheduleCreateEditDrawer({
  open,
  onOpenChange,
  orgId,
  cases,
  pharmacists,
  defaultDate,
  editingProposal,
  onSaved,
}: ScheduleCreateEditDrawerProps) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<ScheduleCreateEditDrawerForm>(() =>
    buildScheduleCreateEditDrawerForm({
      defaultDate,
      proposal: editingProposal,
      cases,
      pharmacists,
    }),
  );

  // ドロワーを開くたび / 編集対象が変わるたびにフォームを初期化する。
  // React 推奨の「レンダー中に state を調整する」パターンで effect を回避する。
  const formSessionKey = `${open ? '1' : '0'}:${editingProposal?.id ?? 'new'}`;
  const [lastFormSessionKey, setLastFormSessionKey] = useState(formSessionKey);
  if (open && formSessionKey !== lastFormSessionKey) {
    setLastFormSessionKey(formSessionKey);
    setForm(
      buildScheduleCreateEditDrawerForm({
        defaultDate,
        proposal: editingProposal,
        cases,
        pharmacists,
      }),
    );
  }

  const selectedCase = useMemo(
    () => cases.find((careCase) => careCase.id === form.case_id) ?? null,
    [cases, form.case_id],
  );
  const visitDestination = selectedCase?.patient.residences[0]?.address ?? '自宅';

  const saveMutation = useMutation({
    mutationFn: async (submitForContact: boolean) => {
      const res = await fetch('/api/visit-schedule-proposals', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-org-id': orgId,
        },
        body: JSON.stringify(
          buildScheduleCreateEditDrawerPayload({
            form,
            proposalId: editingProposal?.id,
            submitForContact,
          }),
        ),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? '予定の保存に失敗しました');
      }
      return submitForContact;
    },
    onSuccess: async (submitForContact) => {
      await queryClient.invalidateQueries({ queryKey: ['visit-schedule-proposals'] });
      toast.success(submitForContact ? '確認待ちにしました' : '下書きを保存しました');
      onOpenChange(false);
      onSaved?.();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '予定の保存に失敗しました');
    },
  });

  const formValid = isScheduleCreateEditDrawerFormValid(form);
  const disabled = saveMutation.isPending || !formValid;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>予定を作成・編集</SheetTitle>
          <SheetDescription>
            1件の訪問予定を下書き保存し、患者確認後に確定へ進めます。
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="drawer-case">患者</Label>
            <Select
              value={form.case_id}
              onValueChange={(value) =>
                setForm((current) => ({ ...current, case_id: value ?? '' }))
              }
            >
              <SelectTrigger id="drawer-case" className="w-full">
                <SelectValue placeholder="患者を選択" />
              </SelectTrigger>
              <SelectContent>
                {cases.map((careCase) => (
                  <SelectItem key={careCase.id} value={careCase.id}>
                    {careCase.patient.name} 様
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="drawer-visit-type">訪問種別</Label>
            <Select
              value={form.visit_type}
              onValueChange={(value) =>
                setForm((current) => ({ ...current, visit_type: value as VisitType }))
              }
            >
              <SelectTrigger id="drawer-visit-type" className="w-full">
                <SelectValue placeholder="訪問種別を選択" />
              </SelectTrigger>
              <SelectContent>
                {VISIT_TYPE_OPTIONS.map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="drawer-date">候補日</Label>
              <Input
                id="drawer-date"
                type="date"
                value={form.proposed_date}
                onChange={(event) =>
                  setForm((current) => ({ ...current, proposed_date: event.target.value }))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="drawer-time">候補時刻</Label>
              <Input
                id="drawer-time"
                type="time"
                value={form.time_window_start}
                onChange={(event) =>
                  setForm((current) => ({ ...current, time_window_start: event.target.value }))
                }
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="drawer-pharmacist">担当薬剤師</Label>
            <Select
              value={form.proposed_pharmacist_id}
              onValueChange={(value) =>
                setForm((current) => ({ ...current, proposed_pharmacist_id: value ?? '' }))
              }
            >
              <SelectTrigger id="drawer-pharmacist" className="w-full">
                <SelectValue placeholder="担当薬剤師を選択" />
              </SelectTrigger>
              <SelectContent>
                {pharmacists.map((pharmacist) => (
                  <SelectItem key={pharmacist.id} value={pharmacist.id}>
                    {pharmacist.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="drawer-destination">訪問先</Label>
            <Input id="drawer-destination" value={visitDestination} readOnly disabled />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="drawer-travel-mode">移動手段</Label>
            <Select
              value={form.travel_mode}
              onValueChange={(value) =>
                setForm((current) => ({ ...current, travel_mode: value as TravelMode }))
              }
            >
              <SelectTrigger id="drawer-travel-mode" className="w-full">
                <SelectValue placeholder="移動手段を選択" />
              </SelectTrigger>
              <SelectContent>
                {TRAVEL_MODE_OPTIONS.map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="drawer-priority">優先度</Label>
            <Select
              value={form.priority}
              onValueChange={(value) =>
                setForm((current) => ({ ...current, priority: value as VisitPriority }))
              }
            >
              <SelectTrigger id="drawer-priority" className="w-full">
                <SelectValue placeholder="優先度を選択" />
              </SelectTrigger>
              <SelectContent>
                {PRIORITY_OPTIONS.map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="drawer-contact-status">患者確認</Label>
            <Select
              value={form.patient_contact_status}
              onValueChange={(value) =>
                setForm((current) => ({
                  ...current,
                  patient_contact_status: value as PatientContactStatus,
                }))
              }
            >
              <SelectTrigger id="drawer-contact-status" className="w-full">
                <SelectValue placeholder="患者確認の状態を選択" />
              </SelectTrigger>
              <SelectContent>
                {DRAFT_CONTACT_STATUS_OPTIONS.map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs leading-5 text-muted-foreground">
              確認済みは確定フローの患者連絡ワークフローで連絡結果として記録します。
            </p>
          </div>

          <div
            role="note"
            className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
          >
            正式決定前の予定です。患者さんへ確認してから確定してください。
          </div>
        </div>

        <SheetFooter className="mt-2 flex-row justify-between gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            onClick={() => saveMutation.mutate(false)}
          >
            {saveMutation.isPending ? '保存中...' : '下書き保存'}
          </Button>
          <Button type="button" disabled={disabled} onClick={() => saveMutation.mutate(true)}>
            {saveMutation.isPending ? '送信中...' : '確認待ちにする'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
