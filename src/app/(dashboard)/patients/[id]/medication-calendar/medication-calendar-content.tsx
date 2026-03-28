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
import { ChevronLeft, ChevronRight, FileText, Printer } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { useOrgId } from '@/lib/hooks/use-org-id';

// --- Types ---

type TimeSlot = 'morning' | 'noon' | 'evening' | 'bedtime';

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

const SLOT_COLORS: Record<TimeSlot, string> = {
  morning: 'bg-yellow-50 text-yellow-800',
  noon: 'bg-blue-50 text-blue-800',
  evening: 'bg-orange-50 text-orange-800',
  bedtime: 'bg-purple-50 text-purple-800',
};

const SLOTS: TimeSlot[] = ['morning', 'noon', 'evening', 'bedtime'];
const EMPTY_PROFILES: MedicationProfile[] = [];

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

function SlotCell({ drugs }: { drugs?: string[] }) {
  if (!drugs || drugs.length === 0) {
    return <span className="text-[10px] text-muted-foreground/40">—</span>;
  }
  return (
    <ul className="space-y-0.5">
      {drugs.map((d, i) => (
        <li key={i} className="text-[10px] leading-tight">{d}</li>
      ))}
    </ul>
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
      const response = await fetch(
        `/api/medication-profiles?patient_id=${patientId}&is_current=true&limit=200`,
        {
          headers: { 'x-org-id': orgId },
        }
      );

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
    [currentMonth, profiles]
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

  const dowLabels = ['日', '月', '火', '水', '木', '金', '土'];

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
          <span className="min-w-[120px] text-center text-base font-semibold">
            {monthLabel}
          </span>
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
            href={`/api/patients/${patientId}/medication-calendar/pdf?month=${format(currentMonth, 'yyyy-MM')}`}
            target="_blank"
            rel="noreferrer"
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            <FileText className="mr-1.5 size-3.5" aria-hidden="true" />
            PDF
          </Link>
          <Button
            size="sm"
            variant="outline"
            onClick={() => window.print()}
            aria-label="印刷"
          >
            <Printer className="mr-1.5 size-3.5" aria-hidden="true" />
            印刷
          </Button>
        </div>
      </div>

      {/* Print header */}
      <div className="hidden print:block mb-4">
        <h1 className="text-lg font-bold">服薬カレンダー — {monthLabel}</h1>
        <p className="text-xs text-gray-500">患者ID: {patientId}</p>
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
        <div className="rounded-lg border border-border bg-card px-4 py-6 text-sm text-muted-foreground">
          服薬カレンダーを読み込んでいます...
        </div>
      ) : medicationQuery.error instanceof Error ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-6 text-sm text-rose-800">
          {medicationQuery.error.message}
        </div>
      ) : profiles.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-card px-4 py-6 text-sm text-muted-foreground">
          現在の服薬情報が登録されていません。服薬管理画面で現行処方を登録するとカレンダーに反映されます。
        </div>
      ) : null}

      {!medicationQuery.isLoading &&
      !(medicationQuery.error instanceof Error) &&
      profiles.length > 0 ? (
        <div className="overflow-x-auto">
          <table
            className="min-w-full border-collapse text-xs print:text-[9px]"
            role="grid"
            aria-label="服薬カレンダー"
          >
            <thead>
              <tr>
                {dowLabels.map((d, i) => (
                  <th
                    key={i}
                    className={`border border-border px-1 py-1 text-center font-medium ${
                      i === 0 ? 'text-red-600' : i === 6 ? 'text-blue-600' : 'text-muted-foreground'
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
                      return <td key={di} className="border border-border bg-muted/20 p-1 align-top min-w-[100px] min-h-[80px]" />;
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
                            isSun ? 'text-red-600' : isSat ? 'text-blue-600' : 'text-foreground'
                          }`}
                        >
                          {dayNum}
                        </div>
                        <div className="space-y-0.5">
                          {SLOTS.map((slot) => {
                            const drugs = day.slots[slot];
                            if (!drugs || drugs.length === 0) return null;
                            return (
                              <div key={slot} className={`rounded px-1 py-0.5 ${SLOT_COLORS[slot]}`}>
                                <span className="font-medium">{SLOT_LABELS[slot]}</span>
                                <SlotCell drugs={drugs} />
                              </div>
                            );
                          })}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

    </div>
  );
}
