'use client';

import { useState } from 'react';
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
import { ChevronLeft, ChevronRight, Printer } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

// --- Types ---

type TimeSlot = 'morning' | 'noon' | 'evening' | 'bedtime';

type DailySchedule = {
  date: string;
  slots: Partial<Record<TimeSlot, string[]>>;
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

// --- Sample schedule ---

function generateSampleSchedule(month: Date): DailySchedule[] {
  const days = eachDayOfInterval({ start: startOfMonth(month), end: endOfMonth(month) });
  return days.map((day) => {
    const dateStr = format(day, 'yyyy-MM-dd');
    return {
      date: dateStr,
      slots: {
        morning: ['アムロジピン錠5mg 1錠', 'ロスバスタチン錠2.5mg 1錠'],
        noon: ['メトホルミン錠250mg 1錠'],
        evening: ['アムロジピン錠5mg 1錠'],
        bedtime: ['ゾルピデム酒石酸塩錠5mg 0.5錠'],
      },
    };
  });
}

// --- Helper ---

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
  const [currentMonth, setCurrentMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });

  const monthLabel = format(currentMonth, 'yyyy年M月', { locale: ja });
  const schedule = generateSampleSchedule(currentMonth);

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

      {/* Calendar grid */}
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

    </div>
  );
}
