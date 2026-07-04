'use client';

import { useMemo, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { z } from 'zod';
import { buildOrgJsonHeaders } from '@/lib/api/org-headers';
import { messageFromError } from '@/lib/utils/error-message';
import { requestNavigationConfirmation } from '@/components/providers/navigation-confirm-provider';
import { useUnsavedChangesGuard } from '@/lib/hooks/use-unsaved-changes-guard';
import { Button } from '@/components/ui/button';
import { FormErrorSummary } from '@/components/ui/form-error-summary';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { collectFormErrorSummaryItems } from '@/lib/forms/errors';
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

const SCHEDULE_DRAWER_EMPTY_FORM: ScheduleCreateEditDrawerForm = {
  case_id: '',
  visit_type: 'regular',
  priority: 'normal',
  proposed_date: '',
  time_window_start: '',
  time_window_end: '',
  proposed_pharmacist_id: '',
  travel_mode: 'DRIVE',
};

function normalizeScheduleCreateEditDrawerForm(
  form?: Partial<ScheduleCreateEditDrawerForm> | null,
): ScheduleCreateEditDrawerForm {
  return {
    case_id: form?.case_id ?? SCHEDULE_DRAWER_EMPTY_FORM.case_id,
    visit_type: form?.visit_type ?? SCHEDULE_DRAWER_EMPTY_FORM.visit_type,
    priority: form?.priority ?? SCHEDULE_DRAWER_EMPTY_FORM.priority,
    proposed_date: form?.proposed_date ?? SCHEDULE_DRAWER_EMPTY_FORM.proposed_date,
    time_window_start: form?.time_window_start ?? SCHEDULE_DRAWER_EMPTY_FORM.time_window_start,
    time_window_end: form?.time_window_end ?? SCHEDULE_DRAWER_EMPTY_FORM.time_window_end,
    proposed_pharmacist_id:
      form?.proposed_pharmacist_id ?? SCHEDULE_DRAWER_EMPTY_FORM.proposed_pharmacist_id,
    travel_mode: form?.travel_mode ?? SCHEDULE_DRAWER_EMPTY_FORM.travel_mode,
  };
}

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
    return normalizeScheduleCreateEditDrawerForm({
      case_id: proposal.case_id,
      visit_type: proposal.visit_type,
      priority: proposal.priority,
      proposed_date: proposal.proposed_date.slice(0, 10),
      time_window_start: normalizeProposalTime(proposal.time_window_start),
      time_window_end: normalizeProposalTime(proposal.time_window_end),
      proposed_pharmacist_id: proposal.proposed_pharmacist_id,
      travel_mode: (proposal.vehicle_resource?.travel_mode as TravelMode | undefined) ?? 'DRIVE',
    });
  }
  const firstCase = cases[0];
  const defaultPharmacistId = firstCase?.primary_pharmacist_id ?? pharmacists[0]?.id ?? '';
  return normalizeScheduleCreateEditDrawerForm({
    case_id: firstCase?.id ?? '',
    visit_type: 'regular',
    priority: 'normal',
    proposed_date: defaultDate,
    time_window_start: '',
    time_window_end: '',
    proposed_pharmacist_id: defaultPharmacistId,
    travel_mode: 'DRIVE',
  });
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

function getScheduleCreateEditDrawerBlockerPath(
  form: ScheduleCreateEditDrawerForm,
): keyof ScheduleCreateEditDrawerForm {
  if (!form.case_id) return 'case_id';
  if (!form.proposed_date) return 'proposed_date';
  if (!form.proposed_pharmacist_id) return 'proposed_pharmacist_id';
  if (form.time_window_start && !form.time_window_end) return 'time_window_end';
  if (!form.time_window_start && form.time_window_end) return 'time_window_start';
  if (
    form.time_window_start &&
    form.time_window_end &&
    timeToMinutes(form.time_window_end) <= timeToMinutes(form.time_window_start)
  ) {
    return 'time_window_end';
  }
  return 'case_id';
}

const scheduleCreateEditDrawerFormSchema = z
  .object({
    case_id: z.string(),
    visit_type: z.custom<VisitType>(),
    priority: z.custom<VisitPriority>(),
    proposed_date: z.string(),
    time_window_start: z.string(),
    time_window_end: z.string(),
    proposed_pharmacist_id: z.string(),
    travel_mode: z.custom<TravelMode>(),
  })
  .superRefine((value, ctx) => {
    const form = normalizeScheduleCreateEditDrawerForm(value);
    const blocker = getScheduleCreateEditDrawerSaveBlocker(form);
    if (!blocker) return;

    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [getScheduleCreateEditDrawerBlockerPath(form)],
      message: blocker,
    });
  });

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

export function ScheduleCreateEditDrawer(props: ScheduleCreateEditDrawerProps) {
  const formSessionKey = `${props.open ? '1' : '0'}:${props.editingProposal?.id ?? 'new'}`;
  return <ScheduleCreateEditDrawerInner key={formSessionKey} {...props} />;
}

function ScheduleCreateEditDrawerInner({
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
  const errorSummaryId = 'schedule-drawer-form-error-summary';
  const initialForm = buildScheduleCreateEditDrawerForm({
    defaultDate,
    proposal: editingProposal,
    cases,
    pharmacists,
  });
  const [baselineForm] = useState<ScheduleCreateEditDrawerForm>(() => initialForm);

  const {
    control,
    formState: { errors },
    getValues,
    handleSubmit,
    register,
  } = useForm<ScheduleCreateEditDrawerForm>({
    resolver: zodResolver(scheduleCreateEditDrawerFormSchema),
    defaultValues: baselineForm,
  });
  const watchedForm = useWatch({ control, defaultValue: baselineForm });
  const form = normalizeScheduleCreateEditDrawerForm(watchedForm);

  const errorSummaryItems = collectFormErrorSummaryItems(errors, {
    case_id: '患者',
    visit_type: '訪問種別',
    priority: '優先度',
    proposed_date: '候補日',
    time_window_start: '開始時刻',
    time_window_end: '終了時刻',
    proposed_pharmacist_id: '担当薬剤師',
    travel_mode: '移動手段',
  });

  function focusErrorSummary() {
    if (typeof document === 'undefined') return;
    document.getElementById(errorSummaryId)?.focus();
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
      const currentForm = normalizeScheduleCreateEditDrawerForm(getValues());
      const res = await fetch('/api/visit-schedule-proposals', {
        method: 'PUT',
        headers: buildOrgJsonHeaders(orgId),
        body: JSON.stringify(
          buildScheduleCreateEditDrawerPayload({
            form: currentForm,
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
      toast.error(messageFromError(error, SCHEDULE_DRAWER_SAVE_ERROR_FALLBACK));
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

        <form
          onSubmit={handleSubmit(() => undefined, focusErrorSummary)}
          noValidate
          className="mt-6 space-y-4"
        >
          <FormErrorSummary id={errorSummaryId} items={errorSummaryItems} />

          <div className="space-y-1.5">
            <Label htmlFor="drawer-case">患者</Label>
            <Controller
              control={control}
              name="case_id"
              render={({ field }) => (
                <Select value={field.value} onValueChange={(value) => field.onChange(value ?? '')}>
                  <SelectTrigger
                    id="drawer-case"
                    className="w-full"
                    aria-invalid={Boolean(errors.case_id)}
                  >
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
              )}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="drawer-visit-type">訪問種別</Label>
            <Controller
              control={control}
              name="visit_type"
              render={({ field }) => (
                <Select
                  value={field.value}
                  onValueChange={(value) => field.onChange(value as VisitType)}
                >
                  <SelectTrigger
                    id="drawer-visit-type"
                    className="w-full"
                    aria-invalid={Boolean(errors.visit_type)}
                  >
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
              )}
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="drawer-date">候補日</Label>
              <Input
                id="drawer-date"
                type="date"
                aria-invalid={Boolean(errors.proposed_date)}
                {...register('proposed_date')}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="drawer-time-start">開始時刻</Label>
              <Input
                id="drawer-time-start"
                type="time"
                aria-invalid={Boolean(errors.time_window_start)}
                {...register('time_window_start')}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="drawer-time-end">終了時刻</Label>
              <Input
                id="drawer-time-end"
                type="time"
                aria-invalid={Boolean(errors.time_window_end)}
                {...register('time_window_end')}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="drawer-pharmacist">担当薬剤師</Label>
            <Controller
              control={control}
              name="proposed_pharmacist_id"
              render={({ field }) => (
                <Select value={field.value} onValueChange={(value) => field.onChange(value ?? '')}>
                  <SelectTrigger
                    id="drawer-pharmacist"
                    className="w-full"
                    aria-invalid={Boolean(errors.proposed_pharmacist_id)}
                  >
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
              )}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="drawer-destination">訪問先</Label>
            <Input id="drawer-destination" value={visitDestination} readOnly disabled />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="drawer-travel-mode">移動手段</Label>
            <Controller
              control={control}
              name="travel_mode"
              render={({ field }) => (
                <Select
                  value={field.value}
                  onValueChange={(value) => field.onChange(value as TravelMode)}
                >
                  <SelectTrigger
                    id="drawer-travel-mode"
                    className="w-full"
                    aria-invalid={Boolean(errors.travel_mode)}
                  >
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
              )}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="drawer-priority">優先度</Label>
            <Controller
              control={control}
              name="priority"
              render={({ field }) => (
                <Select
                  value={field.value}
                  onValueChange={(value) => field.onChange(value as VisitPriority)}
                >
                  <SelectTrigger
                    id="drawer-priority"
                    className="w-full"
                    aria-invalid={Boolean(errors.priority)}
                  >
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
              )}
            />
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
        </form>

        <SheetFooter className="mt-2 flex-row justify-between gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={draftDisabled}
            aria-describedby={draftDescriptionId}
            onClick={() => void handleSubmit(() => saveMutation.mutate(false), focusErrorSummary)()}
          >
            {saveMutation.isPending ? '保存中...' : '下書き保存'}
          </Button>
          <Button
            type="button"
            disabled={contactDisabled}
            aria-describedby={contactDescriptionId}
            onClick={() => void handleSubmit(() => saveMutation.mutate(true), focusErrorSummary)()}
          >
            {saveMutation.isPending ? '送信中...' : '確認待ちにする'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
