export function normalizedDrugCode(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function collectNarcoticCandidateYjCode(
  candidateYjCodes: Set<string>,
  tags: readonly string[],
  ...drugCodes: Array<string | null | undefined>
) {
  if (tags.includes('narcotic')) return;
  for (const drugCode of drugCodes) {
    const code = normalizedDrugCode(drugCode);
    if (code) candidateYjCodes.add(code);
  }
}

export function handlingTagsWithMasterNarcotic<T extends string>(
  tags: readonly T[],
  narcoticYjCodes: Set<string>,
  ...drugCodes: Array<string | null | undefined>
): T[] {
  if (tags.includes('narcotic' as T)) return [...tags];
  const hasMasterNarcotic = drugCodes.some((drugCode) => {
    const code = normalizedDrugCode(drugCode);
    return code != null && narcoticYjCodes.has(code);
  });

  return hasMasterNarcotic ? (['narcotic', ...tags] as T[]) : [...tags];
}
