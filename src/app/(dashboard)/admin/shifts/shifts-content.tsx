'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  format,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  getDay,
  subMonths,
  addMonths,
  isSameDay,
} from 'date-fns';
import { ja } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, Check, X } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useOrgId } from '@/lib/hooks/use-org-id';

// --- Types ---

type ShiftEntry = {
  id: string;
  user_id: string;
  user_name: string;
  date: string;
  available: boolean;
  available_from: string | null;
  available_to: string | null;
};

// --- Sample data ---

const PHARMACISTS = [
  { id: 'u1', name: '鈴木薬剤師' },
  { id: 'u2', name: '田中薬剤師' },
  { id: 'u3', name: '山本薬剤師' },
];

function generateSampleShifts(month: Date): ShiftEntry[] {
  const days = eachDayOfInterval({ start: startOfMonth(month), end: endOfMonth(month) });
  const entries: ShiftEntry[] = [];
  let idCounter = 1;

  for (const pharmacist of PHARMACISTS) {
    for (const day of days) {
      const dow = getDay(day); // 0=Sun, 6=Sat
      if (dow === 0) continue; // Skip Sundays
      const available = !(dow === 6 && pharmacist.id === 'u3'); // u3 no Saturday
      entries.push({
        id: String(idCounter++),
        user_id: pharmacist.id,
        user_name: pharmacist.name,
        date: format(day, 'yyyy-MM-dd'),
        available,
        available_from: available ? '09:00' : null,
        available_to: available ? '18:00' : null,
      });
    }
  }
  return entries;
}

// --- Main ---

export function ShiftsContent() {
  const orgId = useOrgId();
  const [currentMonth, setCurrentMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [editMode, setEditMode] = useState(false);
  const [localShifts, setLocalShifts] = useState<ShiftEntry[]>(() => generateSampleShifts(currentMonth));

  const { data } = useQuery({
    queryKey: ['pharmacist-shifts', orgId, format(currentMonth, 'yyyy-MM')],
    queryFn: async () => {
      const month = format(currentMonth, 'yyyy-MM-01');
      const res = await fetch(`/api/pharmacist-shifts?month=${month}&limit=200`, {
        headers: { 'x-org-id': orgId },
      });
      if (res.status === 404) {
        const sample = generateSampleShifts(currentMonth);
        return { data: sample };
      }
      if (!res.ok) throw new Error('シフトの取得に失敗しました');
      return res.json() as Promise<{ data: ShiftEntry[] }>;
    },
    enabled: !!orgId,
  });

  const shifts = editMode ? localShifts : (data?.data ?? generateSampleShifts(currentMonth));

  const days = eachDayOfInterval({
    start: startOfMonth(currentMonth),
    end: endOfMonth(currentMonth),
  });

  const monthLabel = format(currentMonth, 'yyyy年M月', { locale: ja });

  function toggleShift(userId: string, date: string) {
    if (!editMode) return;
    setLocalShifts((prev) =>
      prev.map((s) =>
        s.user_id === userId && s.date === date
          ? { ...s, available: !s.available }
          : s
      )
    );
  }

  function getShift(userId: string, date: string): ShiftEntry | undefined {
    return shifts.find((s) => s.user_id === userId && s.date === date);
  }

  function handleSave() {
    setEditMode(false);
    toast.success('シフトを保存しました（Phase 2 実装予定）');
  }

  return (
    <div className="space-y-4">
      {/* Header controls */}
      <div className="flex items-center justify-between">
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
          {editMode ? (
            <>
              <Button size="sm" variant="outline" onClick={() => { setEditMode(false); setLocalShifts(data?.data ?? generateSampleShifts(currentMonth)); }}>
                キャンセル
              </Button>
              <Button size="sm" onClick={handleSave}>
                保存
              </Button>
            </>
          ) : (
            <Button size="sm" variant="outline" onClick={() => { setEditMode(true); if (data?.data) setLocalShifts(data.data); }}>
              編集
            </Button>
          )}
        </div>
      </div>

      {editMode && (
        <div className="flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
          セルをクリックして可否をトグルできます
        </div>
      )}

      {/* Calendar grid */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse text-xs" role="grid" aria-label="シフトカレンダー">
              <thead>
                <tr className="border-b border-border bg-muted">
                  <th className="sticky left-0 z-10 bg-muted px-3 py-2 text-left font-medium text-muted-foreground min-w-[100px]">
                    薬剤師
                  </th>
                  {days.map((day) => {
                    const dow = getDay(day);
                    const isSun = dow === 0;
                    const isSat = dow === 6;
                    return (
                      <th
                        key={day.toISOString()}
                        className={`px-1.5 py-2 text-center font-medium min-w-[44px] ${
                          isSun ? 'text-red-600' : isSat ? 'text-blue-600' : 'text-muted-foreground'
                        }`}
                      >
                        <div>{format(day, 'd')}</div>
                        <div className="text-[10px] font-normal">
                          {format(day, 'E', { locale: ja })}
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {PHARMACISTS.map((pharmacist) => (
                  <tr key={pharmacist.id} className="border-b border-border hover:bg-muted/30">
                    <td className="sticky left-0 z-10 bg-background px-3 py-2 font-medium text-sm">
                      {pharmacist.name}
                    </td>
                    {days.map((day) => {
                      const dateStr = format(day, 'yyyy-MM-dd');
                      const shift = getShift(pharmacist.id, dateStr);
                      const dow = getDay(day);
                      const isSun = dow === 0;

                      if (isSun || !shift) {
                        return (
                          <td key={dateStr} className="px-1.5 py-2 text-center text-muted-foreground/30">
                            —
                          </td>
                        );
                      }

                      return (
                        <td
                          key={dateStr}
                          className={`px-1.5 py-2 text-center ${editMode ? 'cursor-pointer hover:bg-muted/50' : ''}`}
                          onClick={() => toggleShift(pharmacist.id, dateStr)}
                        >
                          {shift.available ? (
                            <span
                              className="flex flex-col items-center gap-0.5"
                              aria-label="出勤可"
                            >
                              <Check className="size-3.5 text-green-600" aria-hidden="true" />
                              {shift.available_from && (
                                <span className="text-[9px] text-muted-foreground">
                                  {shift.available_from}
                                </span>
                              )}
                            </span>
                          ) : (
                            <X className="mx-auto size-3.5 text-red-400" aria-label="出勤不可" />
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Legend */}
      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <Check className="size-3.5 text-green-600" aria-hidden="true" />
          出勤可
        </span>
        <span className="flex items-center gap-1">
          <X className="size-3.5 text-red-400" aria-hidden="true" />
          出勤不可
        </span>
      </div>
    </div>
  );
}
