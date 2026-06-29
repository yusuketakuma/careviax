import { medicationIdentityKey } from '@/lib/prescription/medication-diff';

export type IntakeValidationLine = {
  line_number: number;
  drug_name: string;
  drug_code?: string | null;
};

export function collectDuplicatePrescriptionLines(lines: IntakeValidationLine[]) {
  const counts = new Map<
    string,
    { key: string; lines: Array<{ line_number: number; drug_name: string }> }
  >();

  for (const line of lines) {
    const identityKey = medicationIdentityKey(line);
    const duplicateKey = line.drug_code?.trim() || line.drug_name.trim();
    const existing = counts.get(identityKey) ?? { key: duplicateKey, lines: [] };
    existing.lines.push({ line_number: line.line_number, drug_name: line.drug_name });
    counts.set(identityKey, existing);
  }

  return Array.from(counts.values())
    .filter((group) => group.lines.length > 1)
    .map((group) => ({
      key: group.key,
      lines: group.lines,
    }));
}

export function collectStructuringBlockedLines(lines: IntakeValidationLine[]) {
  return lines.filter((line) => {
    const normalizedName = line.drug_name.trim();
    return !line.drug_code?.trim() || /不明|未確認|確認中/.test(normalizedName);
  });
}
