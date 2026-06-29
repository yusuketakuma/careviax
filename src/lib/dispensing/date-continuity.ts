/**
 * 服用日付の継続性検証
 * 前回処方の end_date と今回処方の start_date を比較し、ギャップや重複を検出する。
 */

import { differenceInDays } from 'date-fns';

import { medicationIdentityKey } from '@/lib/prescription/medication-diff';

export interface DateContinuityWarning {
  lineId: string;
  drugName: string;
  drugCode: string | null;
  type: 'gap' | 'overlap';
  prevEndDate: string; // ISO date
  currentStartDate: string; // ISO date
  gapDays: number; // positive=gap, negative=overlap
}

interface LineWithDates {
  id: string;
  drug_name: string;
  drug_master_id?: string | null;
  drug_code: string | null;
  start_date: Date | null;
  end_date: Date | null;
}

/**
 * 前回処方と今回処方の各行を drug_code 優先の namespaced identity でマッチングし、
 * 日付の継続性を検証する。
 */
export function checkDateContinuity(
  currentLines: LineWithDates[],
  previousLines: LineWithDates[],
): DateContinuityWarning[] {
  const warnings: DateContinuityWarning[] = [];

  // Build lookup from previous lines by namespaced drug identity.
  const prevByKey = new Map<string, LineWithDates>();
  for (const line of previousLines) {
    const key = medicationIdentityKey(line);
    prevByKey.set(key, line);
  }

  for (const current of currentLines) {
    if (!current.start_date) continue;

    const key = medicationIdentityKey(current);
    const prev = prevByKey.get(key);
    if (!prev || !prev.end_date) continue;

    const gapDays = differenceInDays(current.start_date, prev.end_date);

    // Gap: more than 1 day between prev end and current start
    if (gapDays > 1) {
      warnings.push({
        lineId: current.id,
        drugName: current.drug_name,
        drugCode: current.drug_code,
        type: 'gap',
        prevEndDate: prev.end_date.toISOString().split('T')[0],
        currentStartDate: current.start_date.toISOString().split('T')[0],
        gapDays,
      });
    }

    // Overlap: current start is before prev end
    if (gapDays < 0) {
      warnings.push({
        lineId: current.id,
        drugName: current.drug_name,
        drugCode: current.drug_code,
        type: 'overlap',
        prevEndDate: prev.end_date.toISOString().split('T')[0],
        currentStartDate: current.start_date.toISOString().split('T')[0],
        gapDays,
      });
    }
  }

  return warnings;
}
