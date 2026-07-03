'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  format,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  getDay,
  subMonths,
  addMonths,
} from 'date-fns';
import { ja } from 'date-fns/locale';
import {
  AlertTriangle,
  CalendarX,
  ChevronLeft,
  ChevronRight,
  FileText,
  Printer,
} from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/loading';
import { buildOrgHeaders } from '@/lib/api/org-headers';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { buildPatientApiPath } from '@/lib/patient/api-paths';

// --- Types ---

export type TimeSlot = 'morning' | 'noon' | 'evening' | 'bedtime';

type DailySchedule = {
  date: string;
  slots: Partial<Record<TimeSlot, string[]>>;
};

type MedicationProfile = {
  id: string;
  drug_name: string;
  dose: string | null;
  frequency: string | null;
  start_date: string | null;
  end_date: string | null;
};

// --- Constants ---

const SLOT_LABELS: Record<TimeSlot, string> = {
  morning: '朝',
  noon: '昼',
  evening: '夕',
  bedtime: '眠前',
};

// 服薬時間帯の識別色(カテゴリ区別であり status ではない)。--time-slot-* トークン。
// 小ピル限定: 最小 fill(/10) + text。
const SLOT_COLORS: Record<TimeSlot, string> = {
  morning: 'bg-time-slot-morning/10 text-time-slot-morning',
  noon: 'bg-time-slot-noon/10 text-time-slot-noon',
  evening: 'bg-time-slot-evening/10 text-time-slot-evening',
  bedtime: 'bg-time-slot-bedtime/10 text-time-slot-bedtime',
};

const SLOTS: TimeSlot[] = ['morning', 'noon', 'evening', 'bedtime'];
const EMPTY_PROFILES: MedicationProfile[] = [];
const DOW_LABELS = ['日', '月', '火', '水', '木', '金', '土'] as const;
const DOW_LONG_LABELS = [
  '日曜日',
  '月曜日',
  '火曜日',
  '水曜日',
  '木曜日',
  '金曜日',
  '土曜日',
] as const;

// --- Helper ---

function inferCalendarSlots(frequency?: string | null): TimeSlot[] {
  const text = frequency ?? '';
  const slots = new Set<TimeSlot>();

  if (text.includes('毎食')) {
    slots.add('morning');
    slots.add('noon');
    slots.add('evening');
  }
  if (text.includes('朝')) slots.add('morning');
  if (text.includes('昼')) slots.add('noon');
  if (text.includes('夕') || text.includes('夜')) slots.add('evening');
  if (text.includes('眠前') || text.includes('就寝')) slots.add('bedtime');

  if (slots.size === 0) {
    slots.add('morning');
  }

  return [...slots];
}

function isMedicationActiveOnDate(profile: MedicationProfile, date: Date) {
  const start = profile.start_date ? new Date(profile.start_date) : null;
  const end = profile.end_date ? new Date(profile.end_date) : null;
  const compare = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

  if (start) {
    const startValue = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime();
    if (compare < startValue) return false;
  }

  if (end) {
    const endValue = new Date(end.getFullYear(), end.getMonth(), end.getDate()).getTime();
    if (compare > endValue) return false;
  }

  return true;
}

function buildCalendarSchedule(month: Date, profiles: MedicationProfile[]): DailySchedule[] {
  const days = eachDayOfInterval({ start: startOfMonth(month), end: endOfMonth(month) });
  return days.map((day) => {
    const slots: Partial<Record<TimeSlot, string[]>> = {};

    for (const profile of profiles) {
      if (!isMedicationActiveOnDate(profile, day)) continue;

      for (const slot of inferCalendarSlots(profile.frequency)) {
        if (!slots[slot]) slots[slot] = [];
        slots[slot]?.push([profile.drug_name, profile.dose].filter(Boolean).join(' '));
      }
    }

    return {
      date: format(day, 'yyyy-MM-dd'),
      slots,
    };
  });
}

export function medicationCalendarColumnLabel(index: number) {
  return DOW_LONG_LABELS[index] ?? '曜日';
}

export function formatMedicationCalendarDayLabel(dateKey: string) {
  const date = new Date(`${dateKey}T00:00:00`);
  if (Number.isNaN(date.getTime())) return '日付未設定';
  return format(date, 'yyyy年M月d日 EEEE', { locale: ja });
}

export function medicationCalendarSlotLabel(dateKey: string, slot: TimeSlot) {
  return `${formatMedicationCalendarDayLabel(dateKey)} ${SLOT_LABELS[slot]}の服薬`;
}

function SlotCell({ drugs }: { drugs?: string[] }) {
  if (!drugs || drugs.length === 0) {
    return <span className="text-[10px] text-muted-foreground/40">—</span>;
  }
  return (
    <ul className="space-y-0.5">
      {drugs.map((d, i) => (
        <li key={i} className="text-[10px] leading-tight">
          {d}
        </li>
      ))}
    </ul>
  );
}

/** その日に1つでも服薬スロットがあるか。desktop セル/モバイルカードの「服薬予定なし」判定に使う。 */
export function hasAnyMedicationSlot(day: { slots: Partial<Record<TimeSlot, string[]>> }): boolean {
  return SLOTS.some((slot) => (day.slots[slot]?.length ?? 0) > 0);
}

function buildCurrentMedicationProfilesPath(patientId: string) {
  const params = new URLSearchParams({
    patient_id: patientId,
    is_current: 'true',
    limit: '200',
  });
  return `/api/medication-profiles?${params.toString()}`;
}

function buildMedicationCalendarPdfHref(patientId: string, month: Date) {
  const params = new URLSearchParams({
    month: format(month, 'yyyy-MM'),
  });
  return `${buildPatientApiPath(patientId, '/medication-calendar/pdf')}?${params.toString()}`;
}

/**
 * 1 日分の服薬スロット（朝/昼/夕/眠前）の共有レンダラ。
 * desktop の月グリッドセルと mobile の日次リストカードの双方から使い、
 * スロット→薬剤のマッピングを 1 箇所に保つ（DRY）。
 */
function DaySlotList({ day }: { day: DailySchedule }) {
  return (
    <div className="space-y-0.5">
      {SLOTS.map((slot) => {
        const drugs = day.slots[slot];
        if (!drugs || drugs.length === 0) return null;
        return (
          <div
            key={slot}
            aria-label={medicationCalendarSlotLabel(day.date, slot)}
            className={`rounded px-1 py-0.5 ${SLOT_COLORS[slot]}`}
          >
            <span className="font-medium">{SLOT_LABELS[slot]}</span>
            <SlotCell drugs={drugs} />
          </div>
        );
      })}
    </div>
  );
}

// --- Main ---

export function MedicationCalendarContent({ patientId }: { patientId: string }) {
  const orgId = useOrgId();
  const [currentMonth, setCurrentMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });

  const monthLabel = format(currentMonth, 'yyyy年M月', { locale: ja });
  const medicationQuery = useQuery({
    queryKey: ['medication-calendar', orgId, patientId],
    queryFn: async () => {
      const response = await fetch(buildCurrentMedicationProfilesPath(patientId), {
        headers: buildOrgHeaders(orgId),
      });

      if (!response.ok) {
        throw new Error('服薬中薬剤の取得に失敗しました');
      }

      return response.json() as Promise<{ data: MedicationProfile[] }>;
    },
    enabled: !!orgId,
  });

  const profiles = medicationQuery.data?.data ?? EMPTY_PROFILES;
  const schedule = useMemo(
    () => buildCalendarSchedule(currentMonth, profiles),
    [currentMonth, profiles],
  );

  const weeks: DailySchedule[][] = [];
  let currentWeek: DailySchedule[] = [];

  // Pad first week with empty slots for alignment
  const firstDay = startOfMonth(currentMonth);
  const startDow = getDay(firstDay); // 0=Sun
  for (let i = 0; i < startDow; i++) {
    currentWeek.push({ date: '', slots: {} });
  }

  for (const day of schedule) {
    currentWeek.push(day);
    if (currentWeek.length === 7) {
      weeks.push(currentWeek);
      currentWeek = [];
    }
  }
  if (currentWeek.length > 0) {
    while (currentWeek.length < 7) {
      currentWeek.push({ date: '', slots: {} });
    }
    weeks.push(currentWeek);
  }

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex items-center justify-between print:hidden">
        <div className="flex items-center gap-2">
          <Button
            size="icon"
            variant="outline"
            onClick={() => setCurrentMonth((m) => subMonths(m, 1))}
            aria-label="前月"
          >
            <ChevronLeft className="size-4" />
          </Button>
          <span className="min-w-[120px] text-center text-base font-semibold">{monthLabel}</span>
          <Button
            size="icon"
            variant="outline"
            onClick={() => setCurrentMonth((m) => addMonths(m, 1))}
            aria-label="翌月"
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={buildMedicationCalendarPdfHref(patientId, currentMonth)}
            target="_blank"
            rel="noreferrer"
            aria-label={`${monthLabel}の服薬カレンダーPDFを開く`}
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            <FileText className="mr-1.5 size-3.5" aria-hidden="true" />
            PDF
          </Link>
          <Button
            size="sm"
            variant="outline"
            onClick={() => window.print()}
            aria-label={`${monthLabel}の服薬カレンダーを印刷`}
          >
            <Printer className="mr-1.5 size-3.5" aria-hidden="true" />
            印刷
          </Button>
        </div>
      </div>

      {/* Print header */}
      <div className="hidden print:block mb-4">
        <h1 className="text-lg font-bold">服薬カレンダー — {monthLabel}</h1>
        <p className="text-xs text-muted-foreground">患者ID: {patientId}</p>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-3 text-xs print:mb-2">
        {SLOTS.map((slot) => (
          <span
            key={slot}
            className={`inline-flex items-center gap-1 rounded px-2 py-0.5 font-medium ${SLOT_COLORS[slot]}`}
          >
            {SLOT_LABELS[slot]}
          </span>
        ))}
      </div>

      {medicationQuery.isLoading ? (
        <div className="space-y-2" data-testid="medication-calendar-loading">
          <span className="sr-only">服薬カレンダーを読み込み中</span>
          <Skeleton className="h-8 w-full" aria-hidden="true" />
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={`week-${i}`} className="h-20 w-full rounded-lg" aria-hidden="true" />
          ))}
        </div>
      ) : medicationQuery.error instanceof Error ? (
        // 取得失敗を raw error 文字列で出さず、固定コピー + role=alert + 再試行で復帰導線を提供。
        <div
          role="alert"
          data-testid="medication-calendar-error"
          className="flex flex-wrap items-center gap-2 rounded-lg border-l-4 border-border/70 border-l-state-blocked bg-card px-4 py-4 text-sm text-state-blocked"
        >
          <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            服薬カレンダーを取得できませんでした。時間をおいて再試行してください。
          </span>
          <button
            type="button"
            onClick={() => void medicationQuery.refetch()}
            className="inline-flex min-h-11 items-center rounded-md border border-state-blocked/40 px-3 text-xs font-medium text-state-blocked hover:bg-state-blocked/10 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            再試行
          </button>
        </div>
      ) : profiles.length === 0 ? (
        <EmptyState
          icon={CalendarX}
          title="現在の服薬情報が登録されていません"
          description="服薬管理画面で現行処方を登録するとカレンダーに反映されます。"
        />
      ) : null}

      {!medicationQuery.isLoading &&
      !(medicationQuery.error instanceof Error) &&
      profiles.length > 0 ? (
        <div className="hidden overflow-x-auto md:block">
          <table
            className="min-w-full border-collapse text-xs print:text-[9px]"
            role="grid"
            aria-label={`${monthLabel}の服薬カレンダー`}
          >
            <caption className="sr-only">{monthLabel}の服薬カレンダー</caption>
            <thead>
              <tr>
                {DOW_LABELS.map((d, i) => (
                  <th
                    key={i}
                    scope="col"
                    aria-label={medicationCalendarColumnLabel(i)}
                    className={`border border-border px-1 py-1 text-center font-medium ${
                      i === 0
                        ? 'text-weekend-sun'
                        : i === 6
                          ? 'text-weekend-sat'
                          : 'text-muted-foreground'
                    }`}
                  >
                    {d}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {weeks.map((week, wi) => (
                <tr key={wi}>
                  {week.map((day, di) => {
                    if (!day.date) {
                      return (
                        <td
                          key={di}
                          aria-label={`${monthLabel}の対象外の日`}
                          className="border border-border bg-muted/20 p-1 align-top min-w-[100px] min-h-[80px]"
                        />
                      );
                    }
                    const dayNum = parseInt(day.date.split('-')[2], 10);
                    const isSun = di === 0;
                    const isSat = di === 6;
                    return (
                      <td
                        key={di}
                        className="border border-border p-1 align-top min-w-[100px] print:min-w-0"
                      >
                        <div
                          className={`mb-1 text-right text-xs font-medium ${
                            isSun
                              ? 'text-weekend-sun'
                              : isSat
                                ? 'text-weekend-sat'
                                : 'text-foreground'
                          }`}
                        >
                          <time dateTime={day.date}>
                            <span aria-hidden="true">{dayNum}</span>
                            <span className="sr-only">
                              {formatMedicationCalendarDayLabel(day.date)}
                            </span>
                          </time>
                        </div>
                        <DaySlotList day={day} />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {/* p1: モバイルは横スクロールの月グリッドではなく日次の縦リスト（その日の服薬を上から
          確認する在宅運用に合わせる）。table(hidden md:block) と list(md:hidden) を display で
          切替し、各 viewport で a11y ツリーに片方のみ残す（aria-hidden 不要）。スロット描画は
          DaySlotList をセルと共有。 */}
      {!medicationQuery.isLoading &&
      !(medicationQuery.error instanceof Error) &&
      profiles.length > 0 ? (
        <ul className="space-y-2 md:hidden" aria-label={`${monthLabel}の服薬カレンダー（日次）`}>
          {weeks
            .flat()
            .filter((day) => day.date)
            .map((day) => (
              <li key={day.date} className="rounded-lg border border-border bg-card p-3">
                <time
                  dateTime={day.date}
                  className="mb-2 block text-sm font-semibold text-foreground"
                >
                  {formatMedicationCalendarDayLabel(day.date)}
                </time>
                {hasAnyMedicationSlot(day) ? (
                  <DaySlotList day={day} />
                ) : (
                  <p className="text-xs text-muted-foreground">服薬予定なし</p>
                )}
              </li>
            ))}
        </ul>
      ) : null}
    </div>
  );
}
