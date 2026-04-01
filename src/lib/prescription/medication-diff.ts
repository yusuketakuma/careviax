/**
 * 処方薬剤の変更検出（共有ユーティリティ）
 */

export interface MedicationChange {
  drug_name: string;
  change_type: 'added' | 'removed' | 'dose_changed' | 'frequency_changed';
  previous: string | null;
  current: string | null;
}

export function prescriptionLineKey(line: { drug_name: string; drug_code?: string | null }): string {
  return line.drug_code || line.drug_name;
}

export function formatDoseFrequency(line: { dose: string; frequency: string }): string {
  return `${line.dose} / ${line.frequency}`;
}

export function detectMedicationChanges(
  currentLines: Array<{ drug_name: string; drug_code?: string | null; dose: string; frequency: string }>,
  previousLines: Array<{ drug_name: string; drug_code?: string | null; dose: string; frequency: string }>,
): MedicationChange[] {
  const prevMap = new Map(previousLines.map((l) => [prescriptionLineKey(l), l]));
  const currMap = new Map(currentLines.map((l) => [prescriptionLineKey(l), l]));
  const changes: MedicationChange[] = [];

  for (const line of currentLines) {
    const prev = prevMap.get(prescriptionLineKey(line));
    if (!prev) {
      changes.push({ drug_name: line.drug_name, change_type: 'added', previous: null, current: formatDoseFrequency(line) });
    } else if (prev.dose !== line.dose) {
      changes.push({ drug_name: line.drug_name, change_type: 'dose_changed', previous: formatDoseFrequency(prev), current: formatDoseFrequency(line) });
    } else if (prev.frequency !== line.frequency) {
      changes.push({ drug_name: line.drug_name, change_type: 'frequency_changed', previous: formatDoseFrequency(prev), current: formatDoseFrequency(line) });
    }
  }

  for (const line of previousLines) {
    if (!currMap.has(prescriptionLineKey(line))) {
      changes.push({ drug_name: line.drug_name, change_type: 'removed', previous: formatDoseFrequency(line), current: null });
    }
  }

  return changes;
}
