'use client';

import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Package, Printer, Loader2 } from 'lucide-react';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

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
    drug_code: string | null;
    dosage_form: string | null;
    dose: string;
    frequency: string;
    unit: string | null;
    packaging_instructions: string | null;
    notes: string | null;
  };
};

type TimeSlot = 'morning' | 'noon' | 'evening' | 'bedtime' | 'prn';

type DrugEntry = {
  drugName: string;
  quantity: string;
  isNarcotic?: boolean;
  isCold?: boolean;
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

const SLOT_ORDER: TimeSlot[] = ['morning', 'noon', 'evening', 'bedtime', 'prn'];

const SLOT_LABELS: Record<TimeSlot, string> = {
  morning: '朝',
  noon: '昼',
  evening: '夕',
  bedtime: '眠前',
  prn: '頓用',
};

const SLOT_COLORS: Record<TimeSlot, string> = {
  morning: 'bg-yellow-50 text-yellow-800 border-yellow-200',
  noon: 'bg-blue-50 text-blue-800 border-blue-200',
  evening: 'bg-orange-50 text-orange-800 border-orange-200',
  bedtime: 'bg-purple-50 text-purple-800 border-purple-200',
  prn: 'bg-gray-50 text-gray-700 border-gray-200',
};

// --- Helpers ---

function batchesToSlotGrid(batches: SetBatch[]): {
  grid: SlotCell[];
  prn: PrnDrug[];
  days: number[];
  usedSlots: TimeSlot[];
} {
  const regularBatches = batches.filter((b) => b.slot !== 'prn');
  const prnBatches = batches.filter((b) => b.slot === 'prn');

  const daySet = new Set<number>();
  for (const b of regularBatches) daySet.add(b.day_number);
  const days = Array.from(daySet).sort((a, z) => a - z);

  const slotCellMap = new Map<string, SlotCell>();
  for (const b of regularBatches) {
    const key = `${b.slot}-${b.day_number}`;
    const specialNotes = `${b.line.packaging_instructions ?? ''} ${b.line.notes ?? ''}`;
    const drug: DrugEntry = {
      drugName: b.line.drug_name,
      quantity: `${b.quantity}${b.line.unit ?? ''}`,
      isCold: /冷所/.test(specialNotes),
      isNarcotic: /麻薬/.test(specialNotes),
    };
    if (slotCellMap.has(key)) {
      slotCellMap.get(key)!.drugs.push(drug);
    } else {
      slotCellMap.set(key, {
        slot: b.slot as TimeSlot,
        day: b.day_number,
        drugs: [drug],
      });
    }
  }

  const grid = Array.from(slotCellMap.values());

  const usedSlotSet = new Set<TimeSlot>();
  for (const c of grid) usedSlotSet.add(c.slot);
  const usedSlots = SLOT_ORDER.filter((s) => usedSlotSet.has(s));

  // PRN drugs — deduplicated by drug name
  const prnMap = new Map<string, PrnDrug>();
  for (const b of prnBatches) {
    if (!prnMap.has(b.line.drug_name)) {
      const specialNotes = `${b.line.packaging_instructions ?? ''} ${b.line.notes ?? ''}`;
      prnMap.set(b.line.drug_name, {
        drugName: b.line.drug_name,
        quantity: `${b.quantity}${b.line.unit ?? ''}`,
        condition: b.line.frequency,
        isCold: /冷所/.test(specialNotes),
        isNarcotic: /麻薬/.test(specialNotes),
      });
    }
  }
  const prn = Array.from(prnMap.values());

  return { grid, prn, days, usedSlots };
}

function getCell(grid: SlotCell[], slot: TimeSlot, day: number): DrugEntry[] {
  return grid.find((c) => c.slot === slot && c.day === day)?.drugs ?? [];
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

function SlotGrid({
  grid,
  days,
  usedSlots,
}: {
  grid: SlotCell[];
  days: number[];
  usedSlots: TimeSlot[];
}) {
  if (usedSlots.length === 0 || days.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">表示するデータがありません。</p>
    );
  }

  return (
    <div className="overflow-x-auto print:overflow-visible">
      <table
        className="min-w-full border-collapse text-sm print:text-xs"
        role="grid"
        aria-label="服薬スロットグリッド"
      >
        <thead>
          <tr>
            <th className="border border-border bg-muted px-3 py-2 text-left text-xs font-medium text-muted-foreground">
              スロット
            </th>
            {days.map((d) => (
              <th
                key={d}
                className="border border-border bg-muted px-3 py-2 text-center text-xs font-medium text-muted-foreground"
              >
                {d}日目
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {usedSlots.map((slot) => (
            <tr key={slot}>
              <td className={`border border-border px-3 py-2 font-medium text-xs ${SLOT_COLORS[slot]}`}>
                {SLOT_LABELS[slot]}
              </td>
              {days.map((day) => {
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
    <Card className="print:break-inside-avoid">
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

function CarryPackChecklist({ drugs }: { drugs: DrugEntry[] }) {
  const allDrugs = [
    ...drugs,
  ];
  const uniqueDrugs = Array.from(new Map(allDrugs.map((d) => [d.drugName, d])).values());

  return (
    <Card className="print:break-inside-avoid">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Package className="size-4" aria-hidden="true" />
            持参パック確認チェックリスト
          </CardTitle>
          <Button
            size="sm"
            variant="outline"
            aria-label="印刷"
            onClick={() => window.print()}
            className="print:hidden"
          >
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
                  className="h-4 w-4 rounded border-border print:border-gray-400"
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
        <div className="mt-4 rounded-md border border-orange-200 bg-orange-50 px-3 py-2 text-xs text-orange-800 print:border-gray-300 print:bg-transparent print:text-gray-800">
          注意: 冷所保管薬は保冷バッグを使用してください。麻薬は薬局の鍵保管帳簿に記録してから持参してください。
        </div>
      </CardContent>
    </Card>
  );
}

// --- Main ---

export function MedicationSetFullContent() {
  const searchParams = useSearchParams();
  const planId = searchParams.get('plan_id');
  const orgId = useOrgId();

  const { data, isLoading, isError } = useQuery({
    queryKey: ['set-batches', planId],
    queryFn: async () => {
      if (!planId) return [];
      const res = await fetch(`/api/set-batches?plan_id=${planId}`, {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('セットバッチの取得に失敗しました');
      const json = await res.json() as { data: SetBatch[] };
      return json.data;
    },
    enabled: Boolean(planId),
  });

  if (!planId) {
    return (
      <div className="rounded-md border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-800">
        URLパラメータ <code>plan_id</code> が指定されていません。
      </div>
    );
  }

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

  const batches = data ?? [];
  const { grid, prn, days, usedSlots } = batchesToSlotGrid(batches);
  const carryDrugMap = new Map<string, DrugEntry>();
  for (const batch of batches.filter((item) => item.carry_type === 'carry')) {
    const specialNotes = `${batch.line.packaging_instructions ?? ''} ${batch.line.notes ?? ''}`;
    if (!carryDrugMap.has(batch.line.drug_name)) {
      carryDrugMap.set(batch.line.drug_name, {
        drugName: batch.line.drug_name,
        quantity: `${batch.quantity}${batch.line.unit ?? ''}`,
        isCold: /冷所/.test(specialNotes),
        isNarcotic: /麻薬/.test(specialNotes),
      });
    }
  }

  return (
    <>
      {/* Print styles */}
      <style>{`
        @media print {
          nav, header, aside, [data-sidebar], .print\\:hidden { display: none !important; }
          body { font-size: 12px; }
          .print\\:break-inside-avoid { break-inside: avoid; }
        }
      `}</style>

      <div className="space-y-6">
        {/* Plan meta */}
        <p className="text-xs text-muted-foreground">
          セットプラン ID: {planId} / バッチ件数: {batches.length}件
        </p>

        {/* Slot grid */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">スロットグリッド</CardTitle>
          </CardHeader>
          <CardContent>
            <SlotGrid grid={grid} days={days} usedSlots={usedSlots} />
          </CardContent>
        </Card>

        {/* PRN section */}
        <PrnSection drugs={prn} />

        {/* Carry pack checklist */}
        <CarryPackChecklist drugs={Array.from(carryDrugMap.values())} />
      </div>
    </>
  );
}
