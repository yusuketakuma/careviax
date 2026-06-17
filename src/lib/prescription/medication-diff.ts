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
  change_type: 'added' | 'removed' | 'dose_changed' | 'frequency_changed' | 'days_changed';
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

export interface MedicationDiffLineMatch<
  TCurrent extends MedicationDiffLine,
  TPrevious extends MedicationDiffLine,
> {
  current: TCurrent | null;
  previous: TPrevious | null;
  current_index: number | null;
  previous_index: number | null;
}

export function prescriptionLineKey(line: {
  drug_name: string;
  drug_code?: string | null;
  dose?: string | null;
  frequency?: string | null;
  days?: number | null;
}): string {
  return [
    line.drug_code?.trim() || line.drug_name.trim(),
    line.dose?.trim() ?? '',
    line.frequency?.trim() ?? '',
    line.days ?? '',
  ].join('|');
}

function medicationIdentityKey(line: { drug_name: string; drug_code?: string | null }): string {
  return line.drug_code?.trim() || line.drug_name.trim();
}

export function formatDoseFrequency(line: { dose: string; frequency: string }): string {
  return `${line.dose} / ${line.frequency}`;
}

export function matchMedicationDiffLines<
  TCurrent extends MedicationDiffLine,
  TPrevious extends MedicationDiffLine,
>(
  currentLines: TCurrent[],
  previousLines: TPrevious[],
): Array<MedicationDiffLineMatch<TCurrent, TPrevious>> {
  const matches: Array<MedicationDiffLineMatch<TCurrent, TPrevious>> = [];
  const matchedPrevious = new Set<number>();

  const findPreviousIndex = (line: TCurrent) => {
    const exactIndex = previousLines.findIndex(
      (previous, index) =>
        !matchedPrevious.has(index) && prescriptionLineKey(previous) === prescriptionLineKey(line),
    );
    if (exactIndex >= 0) return exactIndex;

    const identity = medicationIdentityKey(line);
    const sameFrequencyIndex = previousLines.findIndex(
      (previous, index) =>
        !matchedPrevious.has(index) &&
        medicationIdentityKey(previous) === identity &&
        previous.frequency === line.frequency,
    );
    if (sameFrequencyIndex >= 0) return sameFrequencyIndex;

    return previousLines.findIndex(
      (previous, index) =>
        !matchedPrevious.has(index) && medicationIdentityKey(previous) === identity,
    );
  };

  currentLines.forEach((line, currentIndex) => {
    const previousIndex = findPreviousIndex(line);
    if (previousIndex < 0) {
      matches.push({
        current: line,
        previous: null,
        current_index: currentIndex,
        previous_index: null,
      });
      return;
    }

    matchedPrevious.add(previousIndex);
    matches.push({
      current: line,
      previous: previousLines[previousIndex]!,
      current_index: currentIndex,
      previous_index: previousIndex,
    });
  });

  previousLines.forEach((line, previousIndex) => {
    if (matchedPrevious.has(previousIndex)) return;
    matches.push({
      current: null,
      previous: line,
      current_index: null,
      previous_index: previousIndex,
    });
  });

  return matches;
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
  const changes: MedicationChange[] = [];

  for (const match of matchMedicationDiffLines(currentLines, previousLines)) {
    const line = match.current;
    const prev = match.previous;

    if (line && !prev) {
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
      continue;
    }

    if (!line && prev) {
      changes.push({
        drug_name: prev.drug_name,
        change_type: 'removed',
        previous: formatDoseFrequency(prev),
        current: null,
        previous_frequency: freqOf(prev),
        current_frequency: null,
        previous_days: daysOf(prev),
        current_days: null,
      });
      continue;
    }

    if (!line || !prev) continue;

    if (prescriptionLineKey(prev) === prescriptionLineKey(line)) {
      continue;
    }

    if (prev.dose !== line.dose) {
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
    } else if (daysOf(prev) !== daysOf(line)) {
      // 用量・用法は同一で投与日数のみ変化(セット数量に影響するため検出する)。
      changes.push({
        drug_name: line.drug_name,
        change_type: 'days_changed',
        previous: formatDoseFrequency(prev),
        current: formatDoseFrequency(line),
        previous_frequency: freqOf(prev),
        current_frequency: freqOf(line),
        previous_days: daysOf(prev),
        current_days: daysOf(line),
      });
    }
  }

  return changes;
}
