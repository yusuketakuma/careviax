/**
 * 一包化グループ自動生成
 *
 * 処方の用法テキストから時間帯スロットを解析し、
 * 同じスロットの内服薬を同一グループにまとめる。
 * 外用・注射・頓服はグループ対象外。
 */

export interface PackagingGroupAssignment {
  lineId: string;
  groupId: string | null;     // null = ungrouped
  groupLabel: string;          // "朝食後", "毎食後(朝)" etc.
  slot: string | null;         // "morning" | "noon" | "evening" | "bedtime" | null
  isCrushProhibited: boolean;
}

interface LineInput {
  id: string;
  drug_name: string;
  frequency: string;
  route: string | null;        // "internal" | "external" | "injection" | "other" | null
  packaging_instruction_tags: string[];
}

const SLOT_LABELS: Record<string, string> = {
  morning: '朝食後',
  noon: '昼食後',
  evening: '夕食後',
  bedtime: '就寝前',
};

/**
 * Parse Japanese frequency text to time slots.
 * Mirrors the logic in set-plans/generate-batches/route.ts but with broader coverage.
 */
export function parseFrequencyToSlots(frequency: string): string[] {
  if (!frequency) return [];
  const f = frequency.trim();

  // 毎食後 / 1日3回 / 分3
  if (/毎食後?|1日3回|分3/.test(f)) return ['morning', 'noon', 'evening'];
  // 朝昼夕
  if (/朝昼夕/.test(f)) return ['morning', 'noon', 'evening'];
  // 朝夕 / 1日2回 / 分2
  if (/朝夕|1日2回|分2/.test(f)) return ['morning', 'evening'];
  // 朝食後 / 1日1回朝
  if (/朝食後|1日1回\s*朝|朝のみ/.test(f)) return ['morning'];
  // 昼食後
  if (/昼食後|1日1回\s*昼/.test(f)) return ['noon'];
  // 夕食後 / 1日1回夕
  if (/夕食後|1日1回\s*夕/.test(f)) return ['evening'];
  // 就寝前 / 眠前
  if (/就寝前|眠前|寝る前/.test(f)) return ['bedtime'];
  // 頓服 / 頓用 / 疼痛時 etc.
  if (/頓服|頓用|疼痛時|発熱時|不眠時|嘔気時|必要時/.test(f)) return ['prn'];
  // 食前
  if (/毎食前/.test(f)) return ['morning', 'noon', 'evening'];
  if (/朝食前/.test(f)) return ['morning'];
  if (/夕食前/.test(f)) return ['evening'];
  // 食間
  if (/食間/.test(f)) return ['morning', 'evening'];
  // 朝1回 (set-plans compat)
  if (/朝1回/.test(f)) return ['morning'];

  // Fallback single-slot detection
  if (/朝/.test(f)) return ['morning'];
  if (/昼/.test(f)) return ['noon'];
  if (/夕/.test(f)) return ['evening'];
  if (/眠|就寝/.test(f)) return ['bedtime'];

  return []; // Unknown → ungrouped
}

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
      return [{
        lineId: line.id,
        groupId: null,
        groupLabel: '個別包装',
        slot: null,
        isCrushProhibited,
      }];
    }

    const slots = parseFrequencyToSlots(line.frequency);

    // PRN → ungrouped
    if (slots.length === 0 || slots.includes('prn')) {
      return [{
        lineId: line.id,
        groupId: null,
        groupLabel: slots.includes('prn') ? '頓服' : '個別包装',
        slot: null,
        isCrushProhibited,
      }];
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
