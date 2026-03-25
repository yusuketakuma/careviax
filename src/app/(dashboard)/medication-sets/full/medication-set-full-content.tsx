'use client';

import { useState } from 'react';
import { Package, Printer, ChevronDown } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

// --- Types ---

type SetMethod = 'facility_calendar' | 'four_times_daily' | 'bedtime_only' | 'custom';

type TimeSlot = 'morning' | 'noon' | 'evening' | 'bedtime';

type DrugEntry = {
  drugName: string;
  quantity: string;
  isCold?: boolean;
  isNarcotic?: boolean;
};

type SlotCell = {
  slot: TimeSlot;
  day: number;
  drugs: DrugEntry[];
};

type PrnDrug = DrugEntry & {
  condition: string;
};

// --- Constants ---

const SET_METHOD_OPTIONS: { value: SetMethod; label: string; description: string }[] = [
  { value: 'facility_calendar', label: '施設カレンダー', description: '施設の服薬カレンダーに準拠' },
  { value: 'four_times_daily', label: '1日4回', description: '朝・昼・夕・眠前の4回' },
  { value: 'bedtime_only', label: '眠前のみ', description: '就寝前1回のみ' },
  { value: 'custom', label: 'カスタム', description: '任意のスロットを設定' },
];

const SLOT_LABELS: Record<TimeSlot, string> = {
  morning: '朝',
  noon: '昼',
  evening: '夕',
  bedtime: '眠前',
};

const SLOT_COLORS: Record<TimeSlot, string> = {
  morning: 'bg-yellow-50 text-yellow-800 border-yellow-200',
  noon: 'bg-blue-50 text-blue-800 border-blue-200',
  evening: 'bg-orange-50 text-orange-800 border-orange-200',
  bedtime: 'bg-purple-50 text-purple-800 border-purple-200',
};

const DAYS = [1, 2, 3, 4, 5, 6, 7];

// --- Sample data (placeholder) ---

const SAMPLE_GRID: SlotCell[] = [
  { slot: 'morning', day: 1, drugs: [{ drugName: 'アムロジピン錠5mg', quantity: '1錠' }, { drugName: 'ロスバスタチン錠2.5mg', quantity: '1錠' }] },
  { slot: 'noon', day: 1, drugs: [{ drugName: 'メトホルミン錠250mg', quantity: '1錠' }] },
  { slot: 'evening', day: 1, drugs: [{ drugName: 'アムロジピン錠5mg', quantity: '1錠' }] },
  { slot: 'bedtime', day: 1, drugs: [{ drugName: 'ゾルピデム酒石酸塩錠5mg', quantity: '0.5錠' }] },
  { slot: 'morning', day: 2, drugs: [{ drugName: 'アムロジピン錠5mg', quantity: '1錠' }] },
];

const SAMPLE_PRN: PrnDrug[] = [
  { drugName: '酸化マグネシウム錠330mg', quantity: '1-2錠', condition: '便秘時' },
  { drugName: 'ロキソプロフェンNa錠60mg', quantity: '1錠', condition: '疼痛時（1日3回まで）', isNarcotic: false },
  { drugName: '塩酸モルヒネ錠10mg', quantity: '1錠', condition: '突出痛時', isNarcotic: true },
];

// --- Helper ---

function getCell(grid: SlotCell[], slot: TimeSlot, day: number): DrugEntry[] {
  return grid.find((c) => c.slot === slot && c.day === day)?.drugs ?? [];
}

function slotsForMethod(method: SetMethod): TimeSlot[] {
  switch (method) {
    case 'four_times_daily':
      return ['morning', 'noon', 'evening', 'bedtime'];
    case 'bedtime_only':
      return ['bedtime'];
    case 'facility_calendar':
    case 'custom':
    default:
      return ['morning', 'noon', 'evening', 'bedtime'];
  }
}

// --- Components ---

function DrugBadge({ drug }: { drug: DrugEntry }) {
  return (
    <span className="flex items-center gap-1 text-xs">
      <span>{drug.drugName}</span>
      <span className="font-medium text-muted-foreground">{drug.quantity}</span>
      {drug.isCold && (
        <Badge variant="outline" className="h-4 px-1 text-[10px] text-blue-700 border-blue-300">
          冷所
        </Badge>
      )}
      {drug.isNarcotic && (
        <Badge variant="outline" className="h-4 px-1 text-[10px] text-red-700 border-red-300">
          麻薬
        </Badge>
      )}
    </span>
  );
}

function SlotGrid({ method, grid }: { method: SetMethod; grid: SlotCell[] }) {
  const slots = slotsForMethod(method);

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full border-collapse text-sm" role="grid" aria-label="服薬スロットグリッド">
        <thead>
          <tr>
            <th className="border border-border bg-muted px-3 py-2 text-left text-xs font-medium text-muted-foreground">
              スロット
            </th>
            {DAYS.map((d) => (
              <th key={d} className="border border-border bg-muted px-3 py-2 text-center text-xs font-medium text-muted-foreground">
                {d}日目
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {slots.map((slot) => (
            <tr key={slot}>
              <td className={`border border-border px-3 py-2 font-medium text-xs ${SLOT_COLORS[slot]}`}>
                {SLOT_LABELS[slot]}
              </td>
              {DAYS.map((day) => {
                const drugs = getCell(grid, slot, day);
                return (
                  <td
                    key={day}
                    className="border border-border px-2 py-1.5 align-top min-w-[140px]"
                  >
                    {drugs.length === 0 ? (
                      <span className="text-xs text-muted-foreground">—</span>
                    ) : (
                      <ul className="space-y-0.5">
                        {drugs.map((drug, i) => (
                          <li key={i}>
                            <DrugBadge drug={drug} />
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PrnSection({ drugs }: { drugs: PrnDrug[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">頓用薬</CardTitle>
      </CardHeader>
      <CardContent>
        {drugs.length === 0 ? (
          <p className="text-sm text-muted-foreground">頓用薬はありません。</p>
        ) : (
          <ul className="divide-y divide-border" role="list">
            {drugs.map((d, i) => (
              <li key={i} className="flex items-center justify-between gap-4 py-2">
                <div className="flex items-center gap-2">
                  <DrugBadge drug={d} />
                </div>
                <span className="text-xs text-muted-foreground">{d.condition}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function CarryPackChecklist({ grid, prn }: { grid: SlotCell[]; prn: PrnDrug[] }) {
  const allDrugs = [
    ...grid.flatMap((c) => c.drugs),
    ...prn,
  ];
  const uniqueDrugs = Array.from(new Map(allDrugs.map((d) => [d.drugName, d])).values());

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Package className="size-4" aria-hidden="true" />
            持参パック確認チェックリスト
          </CardTitle>
          <Button size="sm" variant="outline" aria-label="印刷">
            <Printer className="mr-1.5 size-3.5" aria-hidden="true" />
            印刷
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <p className="mb-3 text-xs text-muted-foreground">
          患者宅への持参時に以下を確認してください。
        </p>
        {uniqueDrugs.length === 0 ? (
          <p className="text-sm text-muted-foreground">薬剤が登録されていません。</p>
        ) : (
          <ul className="space-y-2" role="list">
            {uniqueDrugs.map((drug, i) => (
              <li key={i} className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id={`carry-${i}`}
                  className="h-4 w-4 rounded border-border"
                  aria-label={`${drug.drugName} 確認`}
                />
                <label htmlFor={`carry-${i}`} className="flex items-center gap-2 text-sm cursor-pointer">
                  {drug.drugName}
                  {drug.isCold && (
                    <Badge variant="outline" className="text-[10px] text-blue-700 border-blue-300">
                      冷所保管
                    </Badge>
                  )}
                  {drug.isNarcotic && (
                    <Badge variant="outline" className="text-[10px] text-red-700 border-red-300">
                      麻薬 — 鍵管理必須
                    </Badge>
                  )}
                </label>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-4 rounded-md border border-orange-200 bg-orange-50 px-3 py-2 text-xs text-orange-800">
          注意: 冷所保管薬は保冷バッグを使用してください。麻薬は薬局の鍵保管帳簿に記録してから持参してください。
        </div>
      </CardContent>
    </Card>
  );
}

// --- Main ---

export function MedicationSetFullContent() {
  const [method, setMethod] = useState<SetMethod>('four_times_daily');

  const selectedOption = SET_METHOD_OPTIONS.find((o) => o.value === method);

  return (
    <div className="space-y-6">
      {/* Set method selector */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">セット方式</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="w-full sm:w-64">
              <Select
                value={method}
                onValueChange={(v) => setMethod((v ?? 'four_times_daily') as SetMethod)}
              >
                <SelectTrigger aria-label="セット方式を選択">
                  <SelectValue placeholder="方式を選択" />
                </SelectTrigger>
                <SelectContent>
                  {SET_METHOD_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {selectedOption && (
              <p className="text-sm text-muted-foreground">{selectedOption.description}</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Slot grid */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            スロットグリッド
            <ChevronDown className="size-4 text-muted-foreground" aria-hidden="true" />
          </CardTitle>
        </CardHeader>
        <CardContent>
          <SlotGrid method={method} grid={SAMPLE_GRID} />
        </CardContent>
      </Card>

      {/* PRN section */}
      <PrnSection drugs={SAMPLE_PRN} />

      {/* Carry pack checklist */}
      <CarryPackChecklist grid={SAMPLE_GRID} prn={SAMPLE_PRN} />
    </div>
  );
}
