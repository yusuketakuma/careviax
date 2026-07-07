export { parseFrequencyToSlots } from '@/lib/clinical/prescription-line-classification';
import { parseFrequencyToSlots } from '@/lib/clinical/prescription-line-classification';

/**
 * 一包化グループ自動生成
 *
 * 処方の用法テキストから時間帯スロットを解析し、
 * 同じスロットの内服薬を同一グループにまとめる。
 * 外用・注射・頓服はグループ対象外。
 */

export interface PackagingGroupAssignment {
  lineId: string;
  groupId: string | null; // null = ungrouped
  groupLabel: string; // "朝食後", "毎食後(朝)" etc.
  slot: string | null; // "morning" | "noon" | "evening" | "bedtime" | null
  isCrushProhibited: boolean;
}

interface LineInput {
  id: string;
  drug_name: string;
  frequency: string;
  route: string | null; // "internal" | "external" | "injection" | "other" | null
  packaging_instruction_tags: string[];
}

const SLOT_LABELS: Record<string, string> = {
  morning: '朝食後',
  noon: '昼食後',
  evening: '夕食後',
  bedtime: '就寝前',
};

/**
 * Generate packaging groups from prescription lines.
 * Internal-route drugs with same timing slot are grouped together.
 * External/injection/PRN drugs are ungrouped.
 */
export function generatePackagingGroups(lines: LineInput[]): PackagingGroupAssignment[] {
  return lines.flatMap<PackagingGroupAssignment>((line) => {
    const isCrushProhibited = (line.packaging_instruction_tags ?? []).includes('crush_prohibited');

    // External, injection, other routes → ungrouped
    if (line.route && line.route !== 'internal') {
      return [
        {
          lineId: line.id,
          groupId: null,
          groupLabel: '個別包装',
          slot: null,
          isCrushProhibited,
        },
      ];
    }

    const slots = parseFrequencyToSlots(line.frequency);

    // PRN → ungrouped
    if (slots.length === 0 || slots.includes('prn')) {
      return [
        {
          lineId: line.id,
          groupId: null,
          groupLabel: slots.includes('prn') ? '頓服' : '個別包装',
          slot: null,
          isCrushProhibited,
        },
      ];
    }

    // Return one assignment PER SLOT
    return slots.map<PackagingGroupAssignment>((s) => ({
      lineId: line.id,
      groupId: `group_${s}`,
      groupLabel: SLOT_LABELS[s] || s,
      slot: s,
      isCrushProhibited,
    }));
  });
}
