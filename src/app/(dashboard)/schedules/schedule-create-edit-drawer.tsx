'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { requestNavigationConfirmation } from '@/components/providers/navigation-confirm-provider';
import { useUnsavedChangesGuard } from '@/lib/hooks/use-unsaved-changes-guard';
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
  PRIORITY_LABELS,
  VISIT_TYPE_LABELS,
  type CaseOption,
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
const TRAVEL_MODE_OPTIONS = Object.entries(TRAVEL_MODE_LABELS) as Array<[TravelMode, string]>;
const SCHEDULE_DRAWER_SAVE_BLOCKER_ID = 'schedule-drawer-save-blocker';
const SCHEDULE_DRAWER_SAVE_ERROR_FALLBACK = '予定の保存に失敗しました';
const SCHEDULE_DRAWER_UNSAVED_MESSAGE =
  '予定の変更が保存されていません。このまま閉じると入力内容は失われます。閉じますか？';

type ScheduleDrawerErrorEnvelope = {
  error?: unknown;
  message?: unknown;
};

export type ScheduleCreateEditDrawerForm = {
  case_id: string;
  visit_type: VisitType;
  priority: VisitPriority;
  proposed_date: string;
  time_window_start: string;
  time_window_end: string;
  proposed_pharmacist_id: string;
  travel_mode: TravelMode;
};

function normalizeProposalTime(value: string | null | undefined): string {
  if (!value) return '';

  const timeOfDayMatch = value.match(/^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d(?:\.\d{1,3})?)?$/);
  if (timeOfDayMatch) return `${timeOfDayMatch[1]}:${timeOfDayMatch[2]}`;

  const sentinelMatch = value.match(
    /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:?\d{2})?$/,
  );
  if (sentinelMatch) return `${sentinelMatch[1]}:${sentinelMatch[2]}`;

  return '';
}

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
      time_window_start: normalizeProposalTime(proposal.time_window_start),
      time_window_end: normalizeProposalTime(proposal.time_window_end),
      proposed_pharmacist_id: proposal.proposed_pharmacist_id,
      travel_mode: (proposal.vehicle_resource?.travel_mode as TravelMode | undefined) ?? 'DRIVE',
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
    time_window_end: '',
    proposed_pharmacist_id: defaultPharmacistId,
    travel_mode: 'DRIVE',
  };
}

export function isScheduleCreateEditDrawerFormValid(form: ScheduleCreateEditDrawerForm): boolean {
  return Boolean(form.case_id && form.proposed_date && form.proposed_pharmacist_id);
}

function timeToMinutes(value: string) {
  const [hours, minutes] = value.split(':').map((part) => Number.parseInt(part, 10));
  return hours * 60 + minutes;
}

export function getScheduleCreateEditDrawerSaveBlocker(
  form: ScheduleCreateEditDrawerForm,
): string | null {
  const missingFields = [
    form.case_id ? null : '患者',
    form.proposed_date ? null : '候補日',
    form.proposed_pharmacist_id ? null : '担当薬剤師',
  ].filter(Boolean);

  if (missingFields.length > 0) {
    return `保存するには ${missingFields.join('、')} を選択してください。`;
  }
  if (form.time_window_start && !form.time_window_end) {
    return '保存するには 終了時刻も入力してください。';
  }
  if (!form.time_window_start && form.time_window_end) {
    return '保存するには 開始時刻も入力してください。';
  }
  if (
    form.time_window_start &&
    form.time_window_end &&
    timeToMinutes(form.time_window_end) <= timeToMinutes(form.time_window_start)
  ) {
    return '終了時刻は開始時刻より後にしてください。';
  }
  return null;
}

export function getScheduleCreateEditDrawerContactBlocker(
  form: ScheduleCreateEditDrawerForm,
): string | null {
  const saveBlocker = getScheduleCreateEditDrawerSaveBlocker(form);
  if (saveBlocker) return saveBlocker;
  if (!form.time_window_start && !form.time_window_end) {
    return '確認待ちにするには 開始時刻と終了時刻を入力してください。';
  }
  return null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function readScheduleDrawerSaveErrorMessage(body: ScheduleDrawerErrorEnvelope | null): string {
  return (
    nonEmptyString(body?.message) ??
    nonEmptyString(body?.error) ??
    SCHEDULE_DRAWER_SAVE_ERROR_FALLBACK
  );
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
    ...(form.time_window_end ? { time_window_end: form.time_window_end } : {}),
    proposed_pharmacist_id: form.proposed_pharmacist_id,
    travel_mode: form.travel_mode,
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
  const [baselineForm, setBaselineForm] = useState(form);
  // close(open=false)遷移でもリセットする: 破棄確定で閉じた後に同じ対象を再オープンしたとき、
  // 破棄済みの入力が復活しないようにする(Codex review 指摘)。
  if (formSessionKey !== lastFormSessionKey) {
    setLastFormSessionKey(formSessionKey);
    const nextForm = buildScheduleCreateEditDrawerForm({
      defaultDate,
      proposal: editingProposal,
      cases,
      pharmacists,
    });
    setForm(nextForm);
    setBaselineForm(nextForm);
  }

  // 未保存離脱ガード(SSOT 5.7 / FEUX-8): controlled-state フォームなので dirty をベースライン比較で判定。
  const isDirty = open && JSON.stringify(form) !== JSON.stringify(baselineForm);
  useUnsavedChangesGuard({ enabled: isDirty, message: SCHEDULE_DRAWER_UNSAVED_MESSAGE });

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
        const body = (await res.json().catch(() => null)) as ScheduleDrawerErrorEnvelope | null;
        throw new Error(readScheduleDrawerSaveErrorMessage(body));
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
      toast.error(error instanceof Error ? error.message : SCHEDULE_DRAWER_SAVE_ERROR_FALLBACK);
    },
  });

  const draftBlocker = getScheduleCreateEditDrawerSaveBlocker(form);
  const contactBlocker = getScheduleCreateEditDrawerContactBlocker(form);
  const displayedBlocker = draftBlocker ?? contactBlocker;
  const draftDisabled = saveMutation.isPending || Boolean(draftBlocker);
  const contactDisabled = saveMutation.isPending || Boolean(contactBlocker);
  const draftDescriptionId = draftBlocker ? SCHEDULE_DRAWER_SAVE_BLOCKER_ID : undefined;
  const contactDescriptionId = contactBlocker ? SCHEDULE_DRAWER_SAVE_BLOCKER_ID : undefined;

  // Escape/オーバーレイ/×による close も未保存時は確認を挟む(保存成功時の close は
  // onSuccess が親の onOpenChange を直接呼ぶためこのラッパを通らず、確認は出ない)。
  const handleOpenChange = (next: boolean) => {
    if (!next && isDirty && !saveMutation.isPending) {
      void requestNavigationConfirmation(SCHEDULE_DRAWER_UNSAVED_MESSAGE).then((confirmed) => {
        if (confirmed) onOpenChange(false);
      });
      return;
    }
    onOpenChange(next);
  };

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
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

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
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
              <Label htmlFor="drawer-time-start">開始時刻</Label>
              <Input
                id="drawer-time-start"
                type="time"
                value={form.time_window_start}
                onChange={(event) =>
                  setForm((current) => ({ ...current, time_window_start: event.target.value }))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="drawer-time-end">終了時刻</Label>
              <Input
                id="drawer-time-end"
                type="time"
                value={form.time_window_end}
                onChange={(event) =>
                  setForm((current) => ({ ...current, time_window_end: event.target.value }))
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

          <div className="rounded-md border border-border/70 bg-muted/20 px-3 py-2 text-xs leading-5 text-muted-foreground">
            患者連絡の結果は候補詳細の連絡結果フローで記録します。この画面では予定案を作成し、
            「確認待ちへ」で連絡対象に移します。
          </div>

          <div
            role="note"
            className="rounded-lg border-l-4 border-border/70 border-l-state-confirm bg-card px-4 py-3 text-sm text-state-confirm"
          >
            正式決定前の予定です。患者さんへ確認してから確定してください。
          </div>
          {displayedBlocker ? (
            <p
              id={SCHEDULE_DRAWER_SAVE_BLOCKER_ID}
              role="alert"
              className="text-xs text-destructive"
            >
              {displayedBlocker}
            </p>
          ) : null}
        </div>

        <SheetFooter className="mt-2 flex-row justify-between gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={draftDisabled}
            aria-describedby={draftDescriptionId}
            onClick={() => saveMutation.mutate(false)}
          >
            {saveMutation.isPending ? '保存中...' : '下書き保存'}
          </Button>
          <Button
            type="button"
            disabled={contactDisabled}
            aria-describedby={contactDescriptionId}
            onClick={() => saveMutation.mutate(true)}
          >
            {saveMutation.isPending ? '送信中...' : '確認待ちにする'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
