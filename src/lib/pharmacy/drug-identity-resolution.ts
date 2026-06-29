export type PrescriptionDrugCodeSystem = 'yj' | 'receipt' | 'hot' | 'jan';

export type DrugIdentityResolutionMaster = {
  id: string;
  yj_code: string;
  receipt_code?: string | null;
  hot_code?: string | null;
  jan_code?: string | null;
};

export type ResolvedDrugIdentity = {
  status: 'resolved';
  sourceCode: string;
  sourceCodeSystem: PrescriptionDrugCodeSystem;
  canonicalDrugCode: string;
  drug: {
    id: string;
    yj_code: string;
  };
};

export type AmbiguousDrugIdentity = {
  status: 'ambiguous_code';
  sourceCode: string;
  sourceCodeSystem: Exclude<PrescriptionDrugCodeSystem, 'yj'>;
  candidateCount: number;
};

export type DrugIdentityResolution = ResolvedDrugIdentity | AmbiguousDrugIdentity;

export function normalizeMedicationCode(code: string | null | undefined) {
  return code?.replace(/\s/g, '').trim() || null;
}

export function buildDrugIdentityResolutionByCode(
  masters: DrugIdentityResolutionMaster[],
  options: { includeJan?: boolean } = {},
): Map<string, DrugIdentityResolution> {
  const resolvedByYj = new Map<string, ResolvedDrugIdentity>();
  for (const master of masters) {
    const yjCode = normalizeMedicationCode(master.yj_code);
    if (!yjCode || resolvedByYj.has(yjCode)) continue;
    resolvedByYj.set(yjCode, {
      status: 'resolved',
      sourceCode: yjCode,
      sourceCodeSystem: 'yj',
      canonicalDrugCode: yjCode,
      drug: { id: master.id, yj_code: yjCode },
    });
  }

  const nonYjCandidates = new Map<
    string,
    {
      sourceCodeSystem: Exclude<PrescriptionDrugCodeSystem, 'yj'>;
      candidates: Map<string, { id: string; yj_code: string }>;
    }
  >();

  for (const master of masters) {
    const yjCode = normalizeMedicationCode(master.yj_code);
    if (!yjCode) continue;

    const sourceCodes: Array<{
      code: string | null;
      sourceCodeSystem: Exclude<PrescriptionDrugCodeSystem, 'yj'>;
    }> = [
      { code: normalizeMedicationCode(master.receipt_code), sourceCodeSystem: 'receipt' },
      { code: normalizeMedicationCode(master.hot_code), sourceCodeSystem: 'hot' },
      ...(options.includeJan
        ? [{ code: normalizeMedicationCode(master.jan_code), sourceCodeSystem: 'jan' as const }]
        : []),
    ];

    for (const { code, sourceCodeSystem } of sourceCodes) {
      if (!code || resolvedByYj.has(code)) continue;
      const entry = nonYjCandidates.get(code) ?? {
        sourceCodeSystem,
        candidates: new Map<string, { id: string; yj_code: string }>(),
      };
      entry.candidates.set(master.id, { id: master.id, yj_code: yjCode });
      nonYjCandidates.set(code, entry);
    }
  }

  const resolutions = new Map<string, DrugIdentityResolution>(resolvedByYj);
  for (const [sourceCode, entry] of nonYjCandidates.entries()) {
    const candidates = [...entry.candidates.values()];
    resolutions.set(
      sourceCode,
      candidates.length === 1
        ? {
            status: 'resolved',
            sourceCode,
            sourceCodeSystem: entry.sourceCodeSystem,
            canonicalDrugCode: candidates[0].yj_code,
            drug: candidates[0],
          }
        : {
            status: 'ambiguous_code',
            sourceCode,
            sourceCodeSystem: entry.sourceCodeSystem,
            candidateCount: candidates.length,
          },
    );
  }

  return resolutions;
}

export function resolveMedicationCode(
  rawCode: string | null | undefined,
  resolutions: Map<string, DrugIdentityResolution>,
):
  | ResolvedDrugIdentity
  | AmbiguousDrugIdentity
  | { status: 'missing_code'; sourceCode: null }
  | { status: 'code_not_found'; sourceCode: string } {
  const sourceCode = normalizeMedicationCode(rawCode);
  if (!sourceCode) return { status: 'missing_code', sourceCode: null };
  return resolutions.get(sourceCode) ?? { status: 'code_not_found', sourceCode };
}
