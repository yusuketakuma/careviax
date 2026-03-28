export type IntakeValidationLine = {
  line_number: number;
  drug_name: string;
  drug_code?: string;
};

export function collectDuplicatePrescriptionLines(lines: IntakeValidationLine[]) {
  const counts = new Map<string, Array<{ line_number: number; drug_name: string }>>();

  for (const line of lines) {
    const duplicateKey = line.drug_code?.trim() || line.drug_name.trim();
    const existing = counts.get(duplicateKey) ?? [];
    existing.push({ line_number: line.line_number, drug_name: line.drug_name });
    counts.set(duplicateKey, existing);
  }

  return Array.from(counts.entries())
    .filter(([, matchedLines]) => matchedLines.length > 1)
    .map(([key, matchedLines]) => ({
      key,
      lines: matchedLines,
    }));
}

export function collectStructuringBlockedLines(lines: IntakeValidationLine[]) {
  return lines.filter((line) => {
    const normalizedName = line.drug_name.trim();
    return !line.drug_code?.trim() || /不明|未確認|確認中/.test(normalizedName);
  });
}
