/**
 * intake-display.ts
 * Shared display helpers for intake fields.
 * Import label maps and formatters from home-visit-intake to keep a single
 * source of truth, then expose higher-level helpers used across multiple
 * screens (patient detail, cases tab, visit preparation, reports).
 */

export {
  adlLabels,
  careLevelLabels,
  contactMethodLabels,
  dementiaLabels,
  firstVisitSlotLabels,
  formatBoolean,
  formatOptionalDate,
  getHomeVisitIntake,
  housingTypeLabels,
  joinLabeledValues,
  labelOf,
  medicationSupportLabels,
  moneyManagementLabels,
  requesterProfessionLabels,
  specialProcedureLabels,
  type HomeVisitIntake,
} from './home-visit-intake';

import {
  adlLabels,
  careLevelLabels,
  dementiaLabels,
  formatBoolean,
  joinLabeledValues,
  labelOf,
  moneyManagementLabels,
  specialProcedureLabels,
} from './home-visit-intake';
import type { HomeVisitIntake } from './home-visit-intake';

// ---------------------------------------------------------------------------
// IntakeBadge: minimal data for compact badge display
// ---------------------------------------------------------------------------

export type IntakeBadge = {
  key: string;
  label: string;
  value: string;
  /** Highlight the badge when the value indicates elevated risk/need */
  highlight?: boolean;
};

/** Keys exposed as compact badges on the patient master card header area */
const BADGE_KEYS = ['care_level', 'adl_level', 'dementia_level', 'special_medical_procedures'] as const;
type BadgeKey = (typeof BADGE_KEYS)[number];

/** Return true when a care/adl/dementia level warrants visual highlight */
function isHighCareLevel(key: string, value: string): boolean {
  if (key === 'care_level') return ['care_3', 'care_4', 'care_5'].includes(value);
  if (key === 'adl_level') return ['b', 'c'].includes(value);
  if (key === 'dementia_level') return ['iii', 'iv', 'm'].includes(value);
  return false;
}

/**
 * Build compact badge descriptors from an intake object.
 * Returns only badges for fields that have a meaningful value.
 */
export function buildIntakeBadges(intake: HomeVisitIntake | null): IntakeBadge[] {
  if (!intake) return [];

  const badges: IntakeBadge[] = [];

  for (const key of BADGE_KEYS) {
    if (key === 'special_medical_procedures') {
      const procs = intake.special_medical_procedures;
      if (procs && procs.length > 0) {
        const displayed = joinLabeledValues(procs, specialProcedureLabels);
        badges.push({
          key,
          label: '特別処置',
          value: displayed.slice(0, 3).join(' / ') + (displayed.length > 3 ? ` +${displayed.length - 3}` : ''),
          highlight: true,
        });
      }
      continue;
    }

    const raw = intake[key as keyof HomeVisitIntake] as string | undefined;
    if (!raw) continue;

    const labelMap: Record<BadgeKey, { label: string; labels: Record<string, string> }> = {
      care_level: { label: '介護認定', labels: careLevelLabels },
      adl_level: { label: 'ADL', labels: adlLabels },
      dementia_level: { label: '認知症', labels: dementiaLabels },
      special_medical_procedures: { label: '特別処置', labels: specialProcedureLabels },
    };

    const meta = labelMap[key];
    badges.push({
      key,
      label: meta.label,
      value: labelOf(raw, meta.labels),
      highlight: isHighCareLevel(key, raw),
    });
  }

  return badges;
}

// ---------------------------------------------------------------------------
// formatIntakeField: generic field formatter used by case summary rows
// ---------------------------------------------------------------------------

export type IntakeFieldDisplay = {
  label: string;
  display: string;
};

type FieldSpec = {
  label: string;
  format: (intake: HomeVisitIntake) => string | null | undefined;
};

const FIELD_SPECS: Record<string, FieldSpec> = {
  care_level: {
    label: '介護認定',
    format: (i) => labelOf(i.care_level, careLevelLabels),
  },
  adl_level: {
    label: 'ADL (日常生活自立度)',
    format: (i) => labelOf(i.adl_level, adlLabels),
  },
  dementia_level: {
    label: '認知症自立度',
    format: (i) => labelOf(i.dementia_level, dementiaLabels),
  },
  money_management: {
    label: '金銭管理',
    format: (i) => labelOf(i.money_management, moneyManagementLabels),
  },
  narcotics: {
    label: '麻薬',
    format: (i) =>
      i.narcotics_base !== undefined || i.narcotics_rescue !== undefined
        ? [
            `ベース ${formatBoolean(i.narcotics_base)}`,
            `レスキュー ${formatBoolean(i.narcotics_rescue)}`,
          ].join(' / ')
        : null,
  },
  special_medical_procedures: {
    label: '特別な医療・処置',
    format: (i) => {
      const items = joinLabeledValues(i.special_medical_procedures, specialProcedureLabels);
      return items.length > 0 ? items.join(' / ') : null;
    },
  },
  allergy_history: {
    label: 'アレルギー / 副作用歴',
    format: (i) => i.allergy_history ?? null,
  },
  infection_isolation: {
    label: '感染症 / 隔離',
    format: (i) => i.infection_isolation ?? null,
  },
  primary_disease: {
    label: '主病名',
    format: (i) => i.primary_disease ?? null,
  },
};

/**
 * Format a single intake field by key.
 * Returns null when the field is absent, empty, or not a known key.
 */
export function formatIntakeField(
  key: string,
  intake: HomeVisitIntake,
): IntakeFieldDisplay | null {
  const spec = FIELD_SPECS[key];
  if (!spec) return null;

  const display = spec.format(intake);
  if (!display || display === '—') return null;

  return { label: spec.label, display };
}

/**
 * Build a subset of formatted fields from an intake object.
 * `keys` controls which fields to include and their order.
 * Entries where the value is absent/empty are omitted.
 */
export function buildIntakeFieldRows(
  intake: HomeVisitIntake | null,
  keys: string[],
): IntakeFieldDisplay[] {
  if (!intake) return [];
  return keys
    .map((key) => formatIntakeField(key, intake))
    .filter((row): row is IntakeFieldDisplay => row !== null);
}
