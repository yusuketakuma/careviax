/**
 * 処方薬剤の変更検出（共有ユーティリティ）
 */

/** detectMedicationChanges が受け取る最小の処方行。用法(frequency)・日数(days)を含む */
export interface MedicationDiffLine {
  drug_name: string;
  drug_code?: string | null;
  dose: string;
  frequency: string;
  /** 投与日数。未指定の呼び出し元(テスト等)に配慮し optional */
  days?: number | null;
}

export interface MedicationChange {
  drug_name: string;
  change_type: 'added' | 'removed' | 'dose_changed' | 'frequency_changed';
  /** dose / frequency をまとめたラベル(既存互換) */
  previous: string | null;
  current: string | null;
  /** 用法(frequency)。removed のときは現在処方が無いため previous 側のみ */
  previous_frequency: string | null;
  current_frequency: string | null;
  /** 日数(days)。removed のときは previous 側のみ */
  previous_days: number | null;
  current_days: number | null;
}

export function prescriptionLineKey(line: { drug_name: string; drug_code?: string | null }): string {
  return line.drug_code || line.drug_name;
}

export function formatDoseFrequency(line: { dose: string; frequency: string }): string {
  return `${line.dose} / ${line.frequency}`;
}

function freqOf(line: MedicationDiffLine): string {
  return line.frequency;
}

function daysOf(line: MedicationDiffLine): number | null {
  return line.days ?? null;
}

export function detectMedicationChanges(
  currentLines: MedicationDiffLine[],
  previousLines: MedicationDiffLine[],
): MedicationChange[] {
  const prevMap = new Map(previousLines.map((l) => [prescriptionLineKey(l), l]));
  const currMap = new Map(currentLines.map((l) => [prescriptionLineKey(l), l]));
  const changes: MedicationChange[] = [];

  for (const line of currentLines) {
    const prev = prevMap.get(prescriptionLineKey(line));
    if (!prev) {
      changes.push({
        drug_name: line.drug_name,
        change_type: 'added',
        previous: null,
        current: formatDoseFrequency(line),
        previous_frequency: null,
        current_frequency: freqOf(line),
        previous_days: null,
        current_days: daysOf(line),
      });
    } else if (prev.dose !== line.dose) {
      changes.push({
        drug_name: line.drug_name,
        change_type: 'dose_changed',
        previous: formatDoseFrequency(prev),
        current: formatDoseFrequency(line),
        previous_frequency: freqOf(prev),
        current_frequency: freqOf(line),
        previous_days: daysOf(prev),
        current_days: daysOf(line),
      });
    } else if (prev.frequency !== line.frequency) {
      changes.push({
        drug_name: line.drug_name,
        change_type: 'frequency_changed',
        previous: formatDoseFrequency(prev),
        current: formatDoseFrequency(line),
        previous_frequency: freqOf(prev),
        current_frequency: freqOf(line),
        previous_days: daysOf(prev),
        current_days: daysOf(line),
      });
    }
  }

  for (const line of previousLines) {
    if (!currMap.has(prescriptionLineKey(line))) {
      changes.push({
        drug_name: line.drug_name,
        change_type: 'removed',
        previous: formatDoseFrequency(line),
        current: null,
        previous_frequency: freqOf(line),
        current_frequency: null,
        previous_days: daysOf(line),
        current_days: null,
      });
    }
  }

  return changes;
}
