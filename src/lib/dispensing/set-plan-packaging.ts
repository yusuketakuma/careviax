import {
  PACKAGING_INSTRUCTION_TAG_LABELS,
  PACKAGING_METHOD_LABELS,
  type PackagingInstructionTagValue,
  type PackagingMethodValue,
} from './packaging';
import { SET_METHOD_LABELS, type SetMethodValue } from './set-methods';

type PackagingMethodMasterLike = {
  id: string;
  name: string;
  description?: string | null;
};

type PatientPackagingProfileLike = {
  default_packaging_method?: PackagingMethodValue | null;
  medication_box_color?: string | null;
  notes?: string | null;
  box_config?: unknown;
  special_instructions?: string | null;
  cognitive_note?: string | null;
};

type BoxConfigValue = Record<string, string>;

export type SetPlanPackagingSummary = {
  set_method: string;
  set_method_label: string;
  packaging_method_id: string | null;
  packaging_method_name: string | null;
  patient_default_method: string | null;
  patient_default_method_label: string | null;
  medication_box_color: string | null;
  box_config: BoxConfigValue | null;
  special_instructions: string[];
  tag_labels: string[];
};

function normalizeText(value?: string | null) {
  const normalized = value?.replace(/\s+/g, ' ').trim();
  return normalized && normalized.length > 0 ? normalized : null;
}

function normalizeBoxConfig(value: unknown): BoxConfigValue | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const entries = Object.entries(value).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].trim().length > 0
  );
  return entries.length > 0 ? Object.fromEntries(entries) : null;
}

export function buildSetPlanPackagingSummary(args: {
  setMethod: string;
  packagingMethod?: PackagingMethodMasterLike | null;
  patientPackagingProfile?: PatientPackagingProfileLike | null;
  packagingTags?: PackagingInstructionTagValue[];
}) {
  const profile = args.patientPackagingProfile ?? null;
  const boxConfig = normalizeBoxConfig(profile?.box_config);
  const specialInstructions = [
    normalizeText(profile?.notes),
    normalizeText(profile?.special_instructions),
    normalizeText(profile?.cognitive_note),
  ].filter((value): value is string => value != null);
  const uniqueSpecialInstructions = Array.from(new Set(specialInstructions));
  const tagLabels = Array.from(new Set(args.packagingTags ?? []))
    .map((tag) => PACKAGING_INSTRUCTION_TAG_LABELS[tag] ?? tag)
    .filter(Boolean);
  const patientDefaultMethod = args.patientPackagingProfile?.default_packaging_method ?? null;

  return {
    set_method: args.setMethod,
    set_method_label:
      SET_METHOD_LABELS[args.setMethod as SetMethodValue] ?? args.setMethod,
    packaging_method_id: args.packagingMethod?.id ?? null,
    packaging_method_name: args.packagingMethod?.name ?? null,
    patient_default_method: patientDefaultMethod,
    patient_default_method_label: patientDefaultMethod
      ? PACKAGING_METHOD_LABELS[patientDefaultMethod]
      : null,
    medication_box_color: normalizeText(args.patientPackagingProfile?.medication_box_color),
    box_config: boxConfig,
    special_instructions: uniqueSpecialInstructions,
    tag_labels: tagLabels,
  } satisfies SetPlanPackagingSummary;
}
