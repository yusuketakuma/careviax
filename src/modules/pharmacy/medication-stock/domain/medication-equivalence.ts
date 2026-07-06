export type MatchConfidence = 'none' | 'low' | 'medium' | 'high' | 'exact';

export type ClinicalMatchBasis =
  | 'same_drug_master_id'
  | 'same_yj_code'
  | 'same_hot_code'
  | 'same_ingredient_strength_form'
  | 'same_generic_name_dosage_form'
  | 'normalized_name_only';

export type PackageMatchBasis = 'same_gtin' | 'same_jan_code' | 'same_package_quantity';

export type MedicationClinicalIdentity = {
  readonly drugMasterId?: string | null;
  readonly yjCode?: string | null;
  readonly hotCode?: string | null;
  readonly ingredientKey?: string | null;
  readonly strengthKey?: string | null;
  readonly dosageFormKey?: string | null;
  readonly genericNameKey?: string | null;
  readonly medicationNameKey?: string | null;
  readonly manufacturerKey?: string | null;
};

export type MedicationPackageIdentity = {
  readonly gtin?: string | null;
  readonly janCode?: string | null;
  readonly packageQuantity?: {
    readonly value: number;
    readonly unitKey: string;
  } | null;
};

export type MedicationMatchInput = {
  readonly clinical: MedicationClinicalIdentity;
  readonly package?: MedicationPackageIdentity | null;
};

export type MedicationEquivalenceAssessment = {
  readonly clinicalConfidence: MatchConfidence;
  readonly clinicalBasis: readonly ClinicalMatchBasis[];
  readonly packageConfidence: MatchConfidence;
  readonly packageBasis: readonly PackageMatchBasis[];
  readonly clinicalAutoLinkAllowed: boolean;
  readonly packageOnlyMatch: boolean;
  readonly requiresPharmacistReview: boolean;
  readonly warnings: readonly string[];
};

const CONFIDENCE_SCORE: Record<MatchConfidence, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  exact: 4,
};

function pickHigherConfidence(current: MatchConfidence, next: MatchConfidence) {
  return CONFIDENCE_SCORE[next] > CONFIDENCE_SCORE[current] ? next : current;
}

export function normalizeMedicationCode(value: string | null | undefined): string | undefined {
  const normalized = value
    ?.normalize('NFKC')
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '');
  return normalized ? normalized : undefined;
}

export function normalizeMedicationText(value: string | null | undefined): string | undefined {
  const normalized = value
    ?.normalize('NFKC')
    .trim()
    .toLocaleLowerCase('ja-JP')
    .replace(/\s+/g, ' ');
  return normalized ? normalized : undefined;
}

function sameCode(left: string | null | undefined, right: string | null | undefined) {
  const normalizedLeft = normalizeMedicationCode(left);
  const normalizedRight = normalizeMedicationCode(right);
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}

function sameText(left: string | null | undefined, right: string | null | undefined) {
  const normalizedLeft = normalizeMedicationText(left);
  const normalizedRight = normalizeMedicationText(right);
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}

function hasBoth(left: unknown, right: unknown) {
  return left != null && left !== '' && right != null && right !== '';
}

function samePackageQuantity(
  left: MedicationPackageIdentity['packageQuantity'],
  right: MedicationPackageIdentity['packageQuantity'],
) {
  if (!left || !right) return false;
  return (
    Number.isFinite(left.value) &&
    Number.isFinite(right.value) &&
    left.value === right.value &&
    sameText(left.unitKey, right.unitKey)
  );
}

export function assessMedicationEquivalence(
  reference: MedicationMatchInput,
  candidate: MedicationMatchInput,
): MedicationEquivalenceAssessment {
  const clinicalBasis: ClinicalMatchBasis[] = [];
  const packageBasis: PackageMatchBasis[] = [];
  const warnings: string[] = [];
  let clinicalConfidence: MatchConfidence = 'none';
  let packageConfidence: MatchConfidence = 'none';
  let exactMasterOrYjMatch = false;

  if (sameCode(reference.clinical.drugMasterId, candidate.clinical.drugMasterId)) {
    clinicalBasis.push('same_drug_master_id');
    clinicalConfidence = 'exact';
    exactMasterOrYjMatch = true;
  }

  if (sameCode(reference.clinical.yjCode, candidate.clinical.yjCode)) {
    clinicalBasis.push('same_yj_code');
    clinicalConfidence = pickHigherConfidence(clinicalConfidence, 'exact');
    exactMasterOrYjMatch = true;
  } else if (hasBoth(reference.clinical.yjCode, candidate.clinical.yjCode)) {
    warnings.push('yj_code_conflict');
  }

  if (sameCode(reference.clinical.hotCode, candidate.clinical.hotCode)) {
    clinicalBasis.push('same_hot_code');
    clinicalConfidence = pickHigherConfidence(clinicalConfidence, 'high');
  } else if (hasBoth(reference.clinical.hotCode, candidate.clinical.hotCode)) {
    warnings.push('hot_code_conflict');
  }

  const sameIngredientStrengthForm =
    sameText(reference.clinical.ingredientKey, candidate.clinical.ingredientKey) &&
    sameText(reference.clinical.strengthKey, candidate.clinical.strengthKey) &&
    sameText(reference.clinical.dosageFormKey, candidate.clinical.dosageFormKey);
  if (sameIngredientStrengthForm) {
    clinicalBasis.push('same_ingredient_strength_form');
    clinicalConfidence = pickHigherConfidence(clinicalConfidence, 'high');
  }

  const sameGenericForm =
    sameText(reference.clinical.genericNameKey, candidate.clinical.genericNameKey) &&
    sameText(reference.clinical.dosageFormKey, candidate.clinical.dosageFormKey);
  if (!sameIngredientStrengthForm && sameGenericForm) {
    clinicalBasis.push('same_generic_name_dosage_form');
    clinicalConfidence = pickHigherConfidence(clinicalConfidence, 'medium');
  }

  if (
    clinicalBasis.length === 0 &&
    sameText(reference.clinical.medicationNameKey, candidate.clinical.medicationNameKey)
  ) {
    clinicalBasis.push('normalized_name_only');
    clinicalConfidence = pickHigherConfidence(clinicalConfidence, 'low');
  }

  const referencePackage = reference.package ?? null;
  const candidatePackage = candidate.package ?? null;
  if (sameCode(referencePackage?.gtin, candidatePackage?.gtin)) {
    packageBasis.push('same_gtin');
    packageConfidence = pickHigherConfidence(packageConfidence, 'exact');
  }
  if (sameCode(referencePackage?.janCode, candidatePackage?.janCode)) {
    packageBasis.push('same_jan_code');
    packageConfidence = pickHigherConfidence(packageConfidence, 'high');
  }
  if (samePackageQuantity(referencePackage?.packageQuantity, candidatePackage?.packageQuantity)) {
    packageBasis.push('same_package_quantity');
    packageConfidence = pickHigherConfidence(packageConfidence, 'medium');
  }

  const packageOnlyMatch = packageBasis.length > 0 && clinicalConfidence === 'none';
  if (packageOnlyMatch) warnings.push('package_match_without_clinical_identity');
  if (packageBasis.length > 0 && warnings.includes('yj_code_conflict')) {
    warnings.push('package_match_with_yj_conflict');
  }

  const clinicalAutoLinkAllowed = exactMasterOrYjMatch && !warnings.includes('yj_code_conflict');
  const requiresPharmacistReview =
    !clinicalAutoLinkAllowed || clinicalConfidence !== 'exact' || packageOnlyMatch;

  return {
    clinicalConfidence,
    clinicalBasis,
    packageConfidence,
    packageBasis,
    clinicalAutoLinkAllowed,
    packageOnlyMatch,
    requiresPharmacistReview,
    warnings,
  };
}

export function rankMedicationEquivalenceCandidates<T extends MedicationMatchInput>(
  reference: MedicationMatchInput,
  candidates: readonly T[],
): ReadonlyArray<T & { readonly assessment: MedicationEquivalenceAssessment }> {
  return candidates
    .map((candidate) => ({
      ...candidate,
      assessment: assessMedicationEquivalence(reference, candidate),
    }))
    .sort((left, right) => {
      const clinicalDelta =
        CONFIDENCE_SCORE[right.assessment.clinicalConfidence] -
        CONFIDENCE_SCORE[left.assessment.clinicalConfidence];
      if (clinicalDelta !== 0) return clinicalDelta;
      return (
        CONFIDENCE_SCORE[right.assessment.packageConfidence] -
        CONFIDENCE_SCORE[left.assessment.packageConfidence]
      );
    });
}
